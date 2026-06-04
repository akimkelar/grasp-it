#!/usr/bin/env node
/**
 * run-query.mjs
 *
 * Executes a Cypher query against Neo4j using the neo4j-driver and prints
 * results as JSON. Respects NEO4J_CONNECTION_TYPE — if set to "cypher-shell",
 * exits with code 2 to signal the caller should fall back to cypher-shell.
 *
 * Usage:
 *   node run-query.mjs <project-root> <cypher-query> [params-json]
 *
 * Input:
 *   project-root   — root of the project (for .env lookup)
 *   cypher-query   — single-line Cypher query to execute
 *   params-json    — optional JSON string of query parameters
 *
 * Output (stdout as JSON):
 *   { success: true, records: [...], summary: {...} }  — on success
 *   { error: string }                                   — on failure
 *
 * Exit codes:
 *   0 — query executed successfully
 *   1 — Neo4j not configured or query failed
 *   2 — NEO4J_CONNECTION_TYPE is "cypher-shell" — caller should use cypher-shell
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ── Config ─────────────────────────────────────────────────────────────────────

function getNeo4jConfig(projectRoot) {
  // Check NEO4J_CONNECTION_TYPE first
  const connectionType = process.env.NEO4J_CONNECTION_TYPE ||
    (process.env.NEO4J_URI ? "driver" : null);

  if (connectionType === "cypher-shell") {
    return { connectionType: "cypher-shell" };
  }

  // Check environment variables first
  if (process.env.NEO4J_URI && process.env.NEO4J_USERNAME) {
    return {
      connectionType: "driver",
      NEO4J_URI: process.env.NEO4J_URI,
      NEO4J_DATABASE: process.env.NEO4J_DATABASE || "neo4j",
      NEO4J_USERNAME: process.env.NEO4J_USERNAME,
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "password",
    };
  }

  // Try .env in project root
  const envPath = join(projectRoot, ".env");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      const config = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (key === "NEO4J_URI" || key === "NEO4J_DATABASE" ||
            key === "NEO4J_USERNAME" || key === "NEO4J_PASSWORD" ||
            key === "NEO4J_CONNECTION_TYPE") {
          config[key] = value;
        }
      }
      if (config.NEO4J_URI && config.NEO4J_USERNAME) {
        if (config.NEO4J_CONNECTION_TYPE === "cypher-shell") {
          return { connectionType: "cypher-shell" };
        }
        return {
          connectionType: "driver",
          NEO4J_URI: config.NEO4J_URI,
          NEO4J_DATABASE: config.NEO4J_DATABASE || "neo4j",
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

// ── Query runner ───────────────────────────────────────────────────────────────

async function runQuery(neo4jConfig, query, params) {
  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      neo4jConfig.NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(
        neo4jConfig.NEO4J_USERNAME || "neo4j",
        neo4jConfig.NEO4J_PASSWORD || "password"
      ),
    );
  } catch {
    return { error: "neo4j-driver not available" };
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || "neo4j" });
    const result = await session.run(query, params || {});
    const records = result.records.map((r) => {
      const obj = {};
      for (const key of r.keys) {
        obj[key] = r.get(key);
      }
      return obj;
    });
    const summary = {
      counters: result.summary.counters.toJSON(),
      queryType: result.summary.queryType,
      serverInfo: {
        address: result.summary.server.address,
        version: result.summary.server.version,
      },
    };
    await session.close();
    return { success: true, records, summary };
  } catch (err) {
    return { error: err.message };
  } finally {
    if (driver) await driver.close();
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

const [, , projectRoot, query, paramsJson] = process.argv;

if (!projectRoot || !query) {
  console.error("Usage: node run-query.mjs <project-root> <cypher-query> [params-json]");
  process.exit(1);
}

const neo4jConfig = getNeo4jConfig(projectRoot);
if (!neo4jConfig) {
  console.log(JSON.stringify({ error: "No Neo4j configuration found" }));
  process.exit(1);
}

if (neo4jConfig.connectionType === "cypher-shell") {
  process.exit(2); // Signal caller to use cypher-shell
}

const params = paramsJson ? JSON.parse(paramsJson) : {};
const result = await runQuery(neo4jConfig, query, params);
console.log(JSON.stringify(result));
process.exit(result.error ? 1 : 0);