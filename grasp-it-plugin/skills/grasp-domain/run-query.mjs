#!/usr/bin/env node
/**
 * run-query.mjs
 *
 * Executes an arbitrary Cypher query against Neo4j and prints results as JSON.
 *
 * Usage:
 *   node run-query.mjs <project-root> <cypher-query>
 *
 * Arguments:
 *   project-root  — root of the project being analyzed
 *   cypher-query  — the Cypher query to execute
 *
 * Environment:
 *   NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD — credentials (or .env in project root)
 *   NEO4J_CONNECTION_TYPE — "driver" | "cypher-shell" | "mcp" (default: driver)
 *
 * Exit codes:
 *   0 — query succeeded (results printed to stdout)
 *   1 — connection/query failure
 *   2 — driver signaled cypher-shell fallback (caller should fall back to cypher-shell)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "child_process";
import { getNeo4jConfig, getConnectionType } from "./neo4j-config-loader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Neo4j helpers ───────────────────────────────────────────────────────────────

/**
 * Execute a Cypher query via neo4j-driver.
 * Returns { ok: true, records } on success, { ok: false, reason } on failure.
 */
async function runQueryViaDriver(neo4jConfig, query) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch {
    return { ok: false, reason: "neo4j-driver not available", fallback: true };
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || 'neo4j' });
    const result = await session.run(query);
    await session.close();
    // Convert records to plain objects
    const records = result.records.map((record) => {
      const obj = {};
      record.keys.forEach((key) => {
        const value = record.get(key);
        // Convert Neo4j Integer, Date, etc. to plain values
        if (value && typeof value.toString === "function" && value.constructor.name !== "String" && value.constructor.name !== "Number") {
          obj[key] = value.toString();
        } else if (Array.isArray(value)) {
          obj[key] = value.map((v) =>
            v && typeof v.toString === "function" && v.constructor.name !== "String" && v.constructor.name !== "Number"
              ? v.toString()
              : v
          );
        } else {
          obj[key] = value;
        }
      });
      return obj;
    });
    return { ok: true, records };
  } catch (err) {
    // Any driver error while executing the query means the driver can't be used.
    // Signal fallback to cypher-shell (exit 2) so the caller can try that instead.
    // This handles connection refused, timeouts, auth failures, query errors, etc.
    // The caller will decide whether to fall back or treat it as a hard failure.
    return {
      ok: false,
      reason: err.message,
      fallback: true,
    };
  } finally {
    if (driver) await driver.close();
  }
}

/**
 * Execute a Cypher query via cypher-shell.
 * Returns { ok: true, records } on success, { ok: false, reason } on failure.
 */
function runQueryViaCypherShell(neo4jConfig, query) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;
  const uri = NEO4J_URI || "neo4j://localhost:7687";
  const username = NEO4J_USERNAME || "neo4j";
  const password = NEO4J_PASSWORD || "password";

  // Extract host/port from URI for cypher-shell -a argument
  const cypherUri = uri.replace(/^neo4j\+?:\/\//, "bolt://");

  try {
    const output = execFileSync(
      "cypher-shell",
      [
        "-a", cypherUri,
        "-u", username,
        "-p", password,
        "-d", neo4jConfig.NEO4J_DATABASE || "neo4j",
        "--format", "json",
      ],
      { input: query, encoding: "utf-8" },
    );

    // cypher-shell --format json outputs: [{"keys":[...], "fields":[{"row":[...]}]}]
    const parsed = JSON.parse(output.trim());
    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
      return { ok: true, records: [] };
    }
    const resultSet = parsed[0];
    const { keys, fields } = resultSet;
    const records = (fields || []).map((field) => {
      const row = field.row || [];
      const record = {};
      keys.forEach((key, i) => { record[key] = row[i] ?? null; });
      return record;
    });
    return { ok: true, records };
  } catch (err) {
    // If cypher-shell binary not found, signal fallback
    if (err.code === "ENOENT" || err.message.includes("ENOENT")) {
      return { ok: false, reason: "cypher-shell not available", fallback: true };
    }
    return { ok: false, reason: err.message };
  }
}

/**
 * Execute a Cypher query using the configured connection type.
 */
async function runQuery(neo4jConfig, query) {
  const connectionType = getConnectionType();

  if (connectionType === "cypher-shell") {
    return runQueryViaCypherShell(neo4jConfig, query);
  }

  if (connectionType === "mcp") {
    // MCP is out of scope for now — graceful skip (exit 0)
    return { ok: false, reason: "MCP connection type is not yet supported", skipped: true };
  }

  // Default: driver
  const result = await runQueryViaDriver(neo4jConfig, query);
  if (!result.ok && result.fallback) {
    // Driver failed with connection error — signal caller to use cypher-shell
    process.exit(2);
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────

const projectRoot = process.argv[2];
const query = process.argv[3];

if (!projectRoot || !query) {
  console.error("Usage: node run-query.mjs <project-root> <cypher-query>");
  process.exit(1);
}

// Check for Neo4j configuration
const neo4jConfig = getNeo4jConfig(projectRoot);
if (!neo4jConfig) {
  // No Neo4j configured — skip silently (graceful degradation)
  console.log(JSON.stringify({ results: [], skipped: "no Neo4j configuration" }));
  process.exit(0);
}

// Execute the query
const result = await runQuery(neo4jConfig, query);

if (!result.ok) {
  // Check if this is a graceful skip (e.g., MCP not supported)
  if (result.skipped) {
    console.log(JSON.stringify({ results: [], skipped: result.reason }));
    process.exit(0);
  }
  // Check if we should signal fallback to cypher-shell
  if (result.fallback) {
    process.exit(2);
  }
  console.error(`run-query.mjs: Query failed: ${result.reason}`);
  process.exit(1);
}

// Output results as JSON
console.log(JSON.stringify({ results: result.records }));
process.exit(0);
