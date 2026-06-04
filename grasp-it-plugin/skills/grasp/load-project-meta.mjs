#!/usr/bin/env node
/**
 * load-project-meta.mjs
 *
 * Reads project-level metadata (gitCommitHash, lastAnalyzedAt) from the
 * Neo4j `Project` singleton node and prints it as JSON.
 *
 * This is the canonical read path for Phase 0 staleness checks — the skill
 * queries Neo4j first to get the shared canonical hash in multi-user setups,
 * then falls back to knowledge-graph.json for single-user local mode.
 *
 * Usage:
 *   node load-project-meta.mjs <project-root>
 *
 * Output (printed to stdout as JSON):
 *   { gitCommitHash: string, lastAnalyzedAt: string }  — on success
 *   {}                                                  — if no Neo4j or node not found
 *
 * Exit codes:
 *   0 — output written (including empty {})
 *   1 — error (e.g., invalid project root)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "child_process";
import { homedir } from "node:os";

const PROJECT_SINGLETON_ID = "project:singleton";
const GRAPH_FILE = "knowledge-graph.json";
const UA_DIR = ".grasp-it";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config loader ──────────────────────────────────────────────────────────────

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
 * Load project metadata from Neo4j Project singleton via neo4j-driver.
 * Returns null if Neo4j is unavailable or the node doesn't exist yet.
 */
async function loadProjectMetaViaDriver(neo4jConfig) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch {
    return null; // neo4j-driver not available
  }

  try {
    const session = driver.session();
    const result = await session.run(
      `MATCH (p:Project {id: $id}) RETURN p.gitCommitHash AS gitCommitHash, p.lastAnalyzedAt AS lastAnalyzedAt, p.version AS version, p.analyzedFiles AS analyzedFiles`,
      { id: PROJECT_SINGLETON_ID },
    );
    await session.close();
    const record = result.records[0];
    if (!record) return null;
    return {
      gitCommitHash: record.get("gitCommitHash") ?? null,
      lastAnalyzedAt: record.get("lastAnalyzedAt") ?? null,
      version: record.get("version") ?? null,
      analyzedFiles: record.get("analyzedFiles") ?? null,
    };
  } catch {
    return null;
  } finally {
    if (driver) await driver.close();
  }
}

/**
 * Load project metadata from Neo4j Project singleton via cypher-shell.
 * Returns null if Neo4j is unavailable or the node doesn't exist yet.
 */
function loadProjectMetaViaCypherShell(neo4jConfig) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;
  const uri = NEO4J_URI || "neo4j://localhost:7687";
  const username = NEO4J_USERNAME || "neo4j";
  const password = NEO4J_PASSWORD || "password";

  // Extract host/port from URI for cypher-shell -a argument
  const cypherUri = uri.replace(/^neo4j\+?:\/\//, "bolt://");

  const query = `MATCH (p:Project {id: '${PROJECT_SINGLETON_ID}'}) RETURN p.gitCommitHash AS gitCommitHash, p.lastAnalyzedAt AS lastAnalyzedAt, p.version AS version, p.analyzedFiles AS analyzedFiles`;

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

    // cypher-shell outputs CSV-style results. Parse the first row.
    const lines = output.trim().split("\n");
    if (lines.length < 2) return null; // no data
    const headers = lines[0].split(",");
    const values = lines[1].split(",");

    const record = {};
    headers.forEach((h, i) => {
      record[h.trim()] = values[i]?.trim() ?? null;
    });

    return {
      gitCommitHash: record.gitCommitHash ?? null,
      lastAnalyzedAt: record.lastAnalyzedAt ?? null,
      version: record.version ?? null,
      analyzedFiles: record.analyzedFiles != null ? parseInt(record.analyzedFiles, 10) : null,
    };
  } catch (err) {
    // If cypher-shell binary not found, return null (graceful skip)
    if (err.code === "ENOENT" || err.message.includes("ENOENT")) {
      return null;
    }
    return null;
  }
}

/**
 * Load project metadata from Neo4j using configured connection type.
 */
async function loadProjectMetaFromNeo4j(neo4jConfig) {
  const connectionType = getConnectionType();

  if (connectionType === "cypher-shell") {
    return loadProjectMetaViaCypherShell(neo4jConfig);
  }

  if (connectionType === "mcp") {
    // MCP is out of scope for now — graceful skip
    return null;
  }

  // Default: driver
  return loadProjectMetaViaDriver(neo4jConfig);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Usage: node load-project-meta.mjs <project-root>");
  process.exit(1);
}

// Check for test mock — return empty so fallback is used
if (process.env.LOAD_PROJECT_META_MOCK !== undefined) {
  const mockVal = process.env.LOAD_PROJECT_META_MOCK;
  if (mockVal === "" || mockVal === "null") {
    console.log("{}");
    process.exit(0);
  }
  console.log(JSON.stringify({
    gitCommitHash: mockVal,
    lastAnalyzedAt: new Date().toISOString(),
    version: "1.0.0",
    analyzedFiles: 0,
  }));
  process.exit(0);
}

// Check for Neo4j configuration
const neo4jConfig = getNeo4jConfig(projectRoot);
if (!neo4jConfig) {
  // No Neo4j configured — output empty, caller will use knowledge-graph.json fallback
  console.log("{}");
  process.exit(0);
}

// Query Neo4j
const meta = await loadProjectMetaFromNeo4j(neo4jConfig);
if (!meta) {
  // No Project node yet — output empty, caller will treat as first run
  console.log("{}");
  process.exit(0);
}

// Output the result
console.log(JSON.stringify(meta));
process.exit(0);