#!/usr/bin/env node
/**
 * run-query.mjs
 *
 * Executes an arbitrary Cypher query against Neo4j and prints results as JSON.
 *
 * Usage:
 *   node run-query.mjs <project-root> <cypher-query> [params-json]
 *
 * Arguments:
 *   project-root  — root of the project being analyzed
 *   cypher-query  — the Cypher query to execute (use $paramName for placeholders)
 *   params-json   — optional JSON object with Cypher parameters, e.g. '{"currentCommit":"abc123"}'.
 *                   Pass "{}" or omit entirely to execute with no parameters.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "child_process";
import { getNeo4jConfig, getConnectionType } from "./neo4j-config-loader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Neo4j helpers ───────────────────────────────────────────────────────────────

/**
 * Execute a Cypher query via neo4j-driver.
 * Returns { ok: true, records } on success, { ok: false, reason } on failure.
 *
 * Exported for unit testing — tests inject a mocked `neo4j` module so they can
 * capture the params bag passed to `session.run` without a live database.
 *
 * The optional `_neo4j` parameter is an injection seam for tests. When
 * omitted (production path), the function dynamically imports neo4j-driver
 * from node_modules. Tests pass a fake module that records session.run
 * arguments so the params-bag forwarding can be asserted without a live DB.
 */
export async function runQueryViaDriver(neo4jConfig, query, params = {}, _neo4j) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  let driver;
  try {
    // Test mode: use a mock driver that fails predictably
    if (process.env.NEO4J_TEST_MOCK === '1') {
      throw new Error(process.env.NEO4J_TEST_MOCK_ERR || 'Connection refused (TestMock)');
    }
    // Resolve the neo4j module — injected (tests) or dynamic import (prod).
    const neo4j = _neo4j || (await import("neo4j-driver")).default;
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch {
    return { ok: false, reason: "neo4j-driver not available", fallback: true };
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || 'grasp' });
    const result = await session.run(query, params);
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
function runQueryViaCypherShell(neo4jConfig, query, params = {}) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;
  const uri = NEO4J_URI || "neo4j://localhost:7687";
  const username = NEO4J_USERNAME || "neo4j";
  const password = NEO4J_PASSWORD || "password";

  // Extract host/port from URI for cypher-shell -a argument
  const cypherUri = uri
    .replace(/^neo4j\+s:\/\//, "bolt+s://")
    .replace(/^neo4j:\/\//, "bolt://");

  try {
    // Build --param flags from the params bag. cypher-shell supports
    //   --param "name => 'value'"
    // Numbers, booleans, and arrays must be JSON-encoded into the value.
    // Strings get single-quoted and any embedded single quote is escaped.
    const paramArgs = [];
    for (const [name, value] of Object.entries(params || {})) {
      paramArgs.push("--param", formatCypherParam(name, value));
    }

    const output = execFileSync(
      "cypher-shell",
      [
        "-a", cypherUri,
        "-u", username,
        "-p", password,
        "-d", neo4jConfig.NEO4J_DATABASE || "grasp",
        "--format", "plain",
        ...paramArgs,
      ],
      { input: query, encoding: "utf-8", timeout: 10_000 },
    );

    // cypher-shell --format plain outputs (from SimpleOutputFormatter in
    // cypher-shell 2026.03.1+):
    //
    //   key1, key2, key3        <- header line: comma-joined keys from first record
    //   val1, val2, val3        <- data rows:   comma-joined values per record
    //   val1, val2, val3
    //
    // There is no "rows available" trailer in plain format. Null values are
    // rendered as empty strings (e.g. "Alice, , 30"). Lines may be CRLF or LF.
    const records = parseCypherShellPlainOutput(output);
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
 * Format a Cypher parameter for cypher-shell --param flag.
 * Strings → single-quoted with embedded quotes escaped.
 * Numbers / booleans → toString.
 * Arrays / objects → JSON-encoded.
 */
function formatCypherParam(name, value) {
  if (typeof value === "string") {
    return `${name} => '${value.replace(/'/g, "\\'")}'`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${name} => ${value}`;
  }
  // Arrays / objects — JSON-encode. cypher-shell accepts JSON literal syntax
  // for arrays (e.g. [1, 2, 3]) and strings via the same single-quote rule.
  return `${name} => ${JSON.stringify(value)}`;
}

/**
 * Parse plain-text output from cypher-shell.
 *
 * Format (cypher-shell 2026.x SimpleOutputFormatter):
 *   - Line 1: comma-joined keys from the first record (the header).
 *   - Lines 2..N: comma-joined values for each subsequent record.
 *   - Null values are rendered as empty strings.
 *   - No "rows available" trailer.
 *   - Lines may end with LF or CRLF.
 *
 * If the query returns no rows, only the header line is emitted.
 *
 * Returns an array of { [key]: value, ... } records. Values are always
 * strings (cypher-shell's plain format uses .toString() on values).
 * An empty result yields an empty array.
 */
export function parseCypherShellPlainOutput(output) {
  if (output == null) return [];
  // Split on either \r\n or \n; drop the trailing empty line from a final
  // newline. Trim trailing \r from each line so CRLF line endings parse.
  const lines = String(output)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const header = lines[0].split(",");
  if (lines.length === 1) {
    // Header only — query returned no rows.
    return [];
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const record = {};
    header.forEach((key, j) => {
      const v = values[j];
      // Empty string in plain format means NULL in Cypher — normalize.
      record[key] = v === undefined || v === "" ? null : v;
    });
    records.push(record);
  }
  return records;
}

/**
 * Execute a Cypher query using the configured connection type.
 */
async function runQuery(neo4jConfig, query, params) {
  const connectionType = getConnectionType();

  if (connectionType === "cypher-shell") {
    return runQueryViaCypherShell(neo4jConfig, query, params);
  }

  if (connectionType === "mcp") {
    // MCP is out of scope for now — graceful skip (exit 0)
    return { ok: false, reason: "MCP connection type is not yet supported", skipped: true };
  }

  // Default: driver
  const result = await runQueryViaDriver(neo4jConfig, query, params);
  if (!result.ok && result.fallback) {
    // Driver failed with connection error — signal caller to use cypher-shell
    console.error(`run-query.mjs: Query failed (signaling cypher-shell fallback): ${result.reason}`);
    process.exit(2);
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────

// Only run the CLI entry point when this file is executed directly. When the
// module is imported (e.g. by tests), we expose the helpers but do not
// auto-execute a query. This guard is the standard ES-module "is entrypoint"
// check: compare this file's URL against process.argv[1].
const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  const projectRoot = process.argv[2];
  const query = process.argv[3];
  const paramsArg = process.argv[4];

  if (!projectRoot || !query) {
    console.error("Usage: node run-query.mjs <project-root> <cypher-query> [params-json]");
    process.exit(1);
  }

  // Parse optional params bag. Empty object when missing or "{}".
  let params = {};
  if (paramsArg && paramsArg !== "{}") {
    try {
      const parsed = JSON.parse(paramsArg);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        params = parsed;
      } else {
        console.error("run-query.mjs: params-json must be a JSON object");
        process.exit(1);
      }
    } catch (err) {
      console.error(`run-query.mjs: params-json is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }

  // Check for Neo4j configuration
  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    // No Neo4j configured — skip silently (graceful degradation)
    console.log(JSON.stringify({ results: [], skipped: "no Neo4j configuration" }));
    process.exit(0);
  }

  // Execute the query
  const result = await runQuery(neo4jConfig, query, params);

  if (!result.ok) {
    // Check if this is a graceful skip (e.g., MCP not supported)
    if (result.skipped) {
      console.log(JSON.stringify({ results: [], skipped: result.reason }));
      process.exit(0);
    }
    // Check if we should signal fallback to cypher-shell
    if (result.fallback) {
      console.error(`run-query.mjs: Query failed (signaling cypher-shell fallback): ${result.reason}`);
      process.exit(2);
    }
    console.error(`run-query.mjs: Query failed: ${result.reason}`);
    process.exit(1);
  }

  // Output results as JSON
  console.log(JSON.stringify({ results: result.records }));
  process.exit(0);
}
