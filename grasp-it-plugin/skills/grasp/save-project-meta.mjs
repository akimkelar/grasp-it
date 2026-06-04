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
 *   SAVE_PROJECT_META_MOCK — if set, simulates success without Neo4j
 *
 * Exit codes:
 *   0 — persisted successfully (or skipped because no Neo4j config)
 *   1 — Neo4j available but write failed
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_SINGLETON_ID = "project:singleton";
const META_FILE = "meta.json";
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
 * Ensure the uniqueness constraint for Project.id exists.
 * Safe to run even if it already exists (IF NOT EXISTS guard).
 */
async function ensureConstraint(session) {
  await session.run(
    "CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE",
  );
}

/**
 * Persist project metadata to Neo4j Project singleton.
 */
async function saveProjectMetaToNeo4j(neo4jConfig, meta, projectRoot) {
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
const neo4jConfig = getNeo4jConfig(projectRoot);
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
  console.error(`save-project-meta.mjs: Neo4j write failed: ${result.reason}`);
  process.exit(1);
}

process.exit(0);