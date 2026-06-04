#!/usr/bin/env node
/**
 * save-project-meta.mjs
 *
 * Persists project-level metadata (gitCommitHash, lastAnalyzedAt, version,
 * analyzedFiles) to the Neo4j `Project` singleton node.
 *
 * This is the canonical write path for the shared Project singleton — used by
 * Phase 7 of /grasp to store the last-analyzed commit hash in Neo4j so all
 * users in a multi-user setup share the same authoritative hash.
 *
 * Usage:
 *   node save-project-meta.mjs <project-root> [analyzedFiles]
 *
 * Input (via positional args + .grasp-it/meta.json on disk):
 *   project-root   — root of the project being analyzed
 *   analyzedFiles  — number of files analyzed (default: 0)
 *
 * Environment:
 *   NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD — credentials (or .env in project root)
 *   NEO4J_CONNECTION_TYPE — "driver" | "cypher-shell" (default: driver)
 *   SAVE_PROJECT_META_MOCK — if set, simulates success without Neo4j
 *
 * Exit codes:
 *   0 — persisted successfully (or skipped because no Neo4j config)
 *   1 — Neo4j available but write failed
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "child_process";
import { getNeo4jConfig, getConnectionType } from "./neo4j-config-loader.mjs";

const PROJECT_SINGLETON_ID = "project:singleton";
const META_FILE = "meta.json";
const UA_DIR = ".grasp-it";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Neo4j helpers ───────────────────────────────────────────────────────────────

/**
 * Ensure the uniqueness constraint for Project.id exists.
 * Safe to run even if it already exists (IF NOT EXISTS guard).
 */
async function ensureConstraint(session) {
  await session.run(
    "CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE",
  );
}

/**
 * Persist project metadata to Neo4j Project singleton via neo4j-driver.
 */
async function saveProjectMetaViaDriver(neo4jConfig, meta) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch {
    return { ok: false, reason: "neo4j-driver not available" };
  }

  try {
    const session = driver.session();

    // Ensure constraint exists before first MERGE
    try {
      await ensureConstraint(session);
    } catch {
      // Constraint may already exist — that's fine
    }

    await session.run(
      `MERGE (p:Project {id: $id})
       SET p.gitCommitHash  = $gitCommitHash,
           p.lastAnalyzedAt = $lastAnalyzedAt,
           p.version        = $version,
           p.analyzedFiles  = $analyzedFiles,
           p.kind           = "project"`,
      {
        id: PROJECT_SINGLETON_ID,
        gitCommitHash: meta.gitCommitHash,
        lastAnalyzedAt: meta.lastAnalyzedAt,
        version: meta.version,
        analyzedFiles: meta.analyzedFiles,
      },
    );

    await session.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    if (driver) await driver.close();
  }
}

/**
 * Persist project metadata to Neo4j Project singleton via cypher-shell.
 */
function saveProjectMetaViaCypherShell(neo4jConfig, meta) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;
  const uri = NEO4J_URI || "neo4j://localhost:7687";
  const username = NEO4J_USERNAME || "neo4j";
  const password = NEO4J_PASSWORD || "password";

  // Extract host/port from URI for cypher-shell -a argument
  const cypherUri = uri.replace(/^neo4j\+?:\/\//, "bolt://");

  const query = `MERGE (p:Project {id: '${PROJECT_SINGLETON_ID}'})
SET p.gitCommitHash = '${meta.gitCommitHash}',
    p.lastAnalyzedAt = '${meta.lastAnalyzedAt}',
    p.version = '${meta.version}',
    p.analyzedFiles = ${meta.analyzedFiles},
    p.kind = 'project'`;

  try {
    execFileSync(
      "cypher-shell",
      [
        "-a", cypherUri,
        "-u", username,
        "-p", password,
        "--format", "plain",
      ],
      { input: query, encoding: "utf-8" },
    );
    return { ok: true };
  } catch (err) {
    // If cypher-shell binary not found, treat as graceful skip (not installed)
    if (err.code === "ENOENT" || err.message.includes("ENOENT")) {
      return { ok: false, reason: "cypher-shell not available" };
    }
    return { ok: false, reason: err.message };
  }
}

/**
 * Persist project metadata to Neo4j using configured connection type.
 */
async function saveProjectMetaToNeo4j(neo4jConfig, meta, projectRoot) {
  const connectionType = getConnectionType();

  if (connectionType === "cypher-shell") {
    return saveProjectMetaViaCypherShell(neo4jConfig, meta);
  }

  if (connectionType === "mcp") {
    // MCP is out of scope for now — graceful skip
    return { ok: false, reason: "MCP connection type not yet supported" };
  }

  // Default: driver
  return saveProjectMetaViaDriver(neo4jConfig, meta);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const projectRoot = process.argv[2];
const analyzedFilesArg = process.argv[3];

if (!projectRoot) {
  console.error("Usage: node save-project-meta.mjs <project-root> [analyzedFiles]");
  process.exit(1);
}

// Load meta.json to get the values to persist
const metaPath = join(projectRoot, UA_DIR, META_FILE);
if (!existsSync(metaPath)) {
  console.error("save-project-meta.mjs: meta.json not found — this script must run after meta.json is written.");
  process.exit(1);
}

let meta;
try {
  meta = JSON.parse(readFileSync(metaPath, "utf-8"));
} catch (err) {
  console.error(`save-project-meta.mjs: failed to read meta.json: ${err.message}`);
  process.exit(1);
}

// Override analyzedFiles if provided as CLI arg
if (analyzedFilesArg !== undefined) {
  meta.analyzedFiles = parseInt(analyzedFilesArg, 10);
}

// Check for test mock
if (process.env.SAVE_PROJECT_META_MOCK !== undefined) {
  console.log("[save-project-meta.mjs] Mock mode — skipping Neo4j write.");
  process.exit(0);
}

// Check for Neo4j configuration
const neo4jConfig = await getNeo4jConfig(projectRoot);
if (!neo4jConfig) {
  // No Neo4j configured — skip silently (graceful degradation)
  process.exit(0);
}

// Persist to Neo4j
const result = await saveProjectMetaToNeo4j(neo4jConfig, meta, projectRoot);
if (!result.ok) {
  if (result.reason === "neo4j-driver not available") {
    // Driver not installed — skip silently
    process.exit(0);
  }
  if (result.reason === "cypher-shell not available") {
    // cypher-shell not installed — skip silently
    process.exit(0);
  }
  if (result.reason === "MCP connection type not yet supported") {
    console.log("[save-project-meta.mjs] MCP connection type is not yet supported — skipping.");
    process.exit(0);
  }
  console.error(`save-project-meta.mjs: Neo4j write failed: ${result.reason}`);
  process.exit(1);
}

process.exit(0);