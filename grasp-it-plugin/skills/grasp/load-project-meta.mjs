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

const PROJECT_SINGLETON_ID = "project:singleton";
const GRAPH_FILE = "knowledge-graph.json";
const UA_DIR = ".grasp-it";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Neo4j helpers ───────────────────────────────────────────────────────────────

/**
 * Try to get Neo4j config from environment or .env file.
 */
function getNeo4jConfig(projectRoot) {
  // Check environment variables first
  if (process.env.NEO4J_URI && process.env.NEO4J_USERNAME) {
    return {
      NEO4J_URI: process.env.NEO4J_URI,
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
        if (key === "NEO4J_URI" || key === "NEO4J_USERNAME" || key === "NEO4J_PASSWORD") {
          config[key] = value;
        }
      }
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
 * Load project metadata from Neo4j Project singleton.
 * Returns null if Neo4j is unavailable or the node doesn't exist yet.
 */
async function loadProjectMetaFromNeo4j(neo4jConfig) {
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