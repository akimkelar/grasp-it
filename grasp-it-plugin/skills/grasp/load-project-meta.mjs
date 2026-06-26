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
import { getNeo4jConfig, getConnectionType } from "./neo4j-config-loader.mjs";

const PROJECT_SINGLETON_ID = "project:singleton";
const GRAPH_FILE = "knowledge-graph.json";
const UA_DIR = ".grasp-it";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Neo4j helpers ───────────────────────────────────────────────────────────────

/**
 * Load project metadata from Neo4j Project singleton via neo4j-driver.
 * Returns null if Neo4j is unavailable or the node doesn't exist yet.
 */
async function loadProjectMetaViaDriver(neo4jConfig) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  let driver;
  try {
    // Test mode: use a mock driver that fails predictably
    if (process.env.NEO4J_TEST_MOCK === '1') {
      throw new Error(process.env.NEO4J_TEST_MOCK_ERR || 'Connection refused (TestMock)');
    }
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch {
    return null; // neo4j-driver not available
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || 'grasp' });
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
  const cypherUri = uri
    .replace(/^neo4j\+s:\/\//, "bolt+s://")
    .replace(/^neo4j:\/\//, "bolt://");

  const query = `MATCH (p:Project {id: '${PROJECT_SINGLETON_ID}'}) RETURN p.gitCommitHash AS gitCommitHash, p.lastAnalyzedAt AS lastAnalyzedAt, p.version AS version, p.analyzedFiles AS analyzedFiles`;

  try {
    const output = execFileSync(
      "cypher-shell",
      [
        "-a", cypherUri,
        "-u", username,
        "-p", password,
        "-d", neo4jConfig.NEO4J_DATABASE || "grasp",
        "--format", "json",
      ],
      { input: query, encoding: "utf-8", timeout: 10_000 },
    );

    // cypher-shell --format json outputs: [{"keys":[...], "fields":[{"row":[...]}]}]
    const parsed = JSON.parse(output.trim());
    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) return null;
    const resultSet = parsed[0];
    const { keys, fields } = resultSet;
    if (!fields || fields.length === 0) return null;
    const row = fields[0].row || [];
    const record = {};
    keys.forEach((key, i) => { record[key] = row[i] ?? null; });

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