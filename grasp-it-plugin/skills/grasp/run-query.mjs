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
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config loader (shared pattern) ─────────────────────────────────────────────

/**
 * Parse a .env file content and return key-value pairs.
 */
function parseEnvFile(content) {
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Try to get Neo4j config from environment or .env file.
 * Implements three-level priority: env vars -> <projectRoot>/.env -> ~/.grasp-it/neo4j.env
 *
 * @param {string} projectRoot - The project root directory
 * @returns {{ NEO4J_URI: string, NEO4J_USERNAME: string, NEO4J_PASSWORD: string } | null}
 */
function getNeo4jConfig(projectRoot) {
  // 1. Check environment variables first
  if (process.env.NEO4J_URI && process.env.NEO4J_USERNAME) {
    return {
      NEO4J_URI: process.env.NEO4J_URI,
      NEO4J_USERNAME: process.env.NEO4J_USERNAME,
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "password",
    };
  }

  // 2. Try .env in project root
  if (projectRoot) {
    const projectEnvPath = join(projectRoot, ".env");
    if (existsSync(projectEnvPath)) {
      try {
        const content = readFileSync(projectEnvPath, "utf-8");
        const config = parseEnvFile(content);
        if (config.NEO4J_URI && config.NEO4J_USERNAME) {
          return {
            NEO4J_URI: config.NEO4J_URI,
            NEO4J_USERNAME: config.NEO4J_USERNAME,
            NEO4J_PASSWORD: config.NEO4J_PASSWORD || "password",
          };
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. Try global config ~/.grasp-it/neo4j.env
  const globalConfigPath = join(homedir(), ".grasp-it", "neo4j.env");
  if (existsSync(globalConfigPath)) {
    try {
      const content = readFileSync(globalConfigPath, "utf-8");
      const config = parseEnvFile(content);
      if (config.NEO4J_URI && config.NEO4J_USERNAME) {
        return {
          NEO4J_URI: config.NEO4J_URI,
          NEO4J_USERNAME: config.NEO4J_USERNAME,
          NEO4J_PASSWORD: config.NEO4J_PASSWORD || "password",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Get the connection type from environment variable or default to "driver".
 */
function getConnectionType() {
  return process.env.NEO4J_CONNECTION_TYPE || "driver";
}

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
    const session = driver.session();
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
        "--format", "plain",
      ],
      { input: query, encoding: "utf-8" },
    );

    // cypher-shell outputs CSV-style results. Parse into records.
    const lines = output.trim().split("\n");
    if (lines.length === 0) {
      return { ok: true, records: [] };
    }

    const headers = lines[0].split(",").map((h) => h.trim());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      const record = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] ?? null;
      });
      records.push(record);
    }

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
