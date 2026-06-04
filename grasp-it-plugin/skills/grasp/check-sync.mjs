#!/usr/bin/env node
/**
 * check-sync.mjs
 *
 * Compares the git commit hash stored in the local `knowledge-graph.json`
 * against the `Project` singleton node in Neo4j, and reports which is ahead,
 * behind, or in sync.
 *
 * Usage:
 *   node check-sync.mjs [project-root]
 *
 * Exit codes:
 *   0  — in sync or local-behind (action: pull / re-run /grasp)
 *   1  — local-ahead on tracked branch (action: safe to update Neo4j)
 *   2  — diverged or local-ahead on feature branch (manual resolution)
 *   3  — Neo4j has no analysis yet
 *   4  — local graph not found or error
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "child_process";
import { mkdirSync } from "node:fs";

const PROJECT_SINGLETON_ID = "project:singleton";
const GRAPH_FILE = "knowledge-graph.json";
const UA_DIR = ".grasp-it";

// ── Git helpers ────────────────────────────────────────────────────────────────

function isAncestor(projectRoot, ancestor, descendant) {
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      { cwd: projectRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}

function isOnTrackedBranch(projectRoot, commitHash) {
  // Check if the current local branch is main or develop (a tracked branch).
  // We verify this by checking that the branch name is one of the tracked branches,
  // not just that the commit happens to be an ancestor of a tracked branch.
  let currentBranch;
  try {
    currentBranch = execFileSync(
      "git",
      ["rev-parse", "--symbolic-full-name", "HEAD"],
      { cwd: projectRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  } catch {
    return false;
  }

  const isTrackedBranch =
    currentBranch.endsWith("/main") || currentBranch.endsWith("/develop");

  if (!isTrackedBranch) return false;

  // Verify the commit is reachable from the tracked branch
  for (const branch of ["origin/main", "origin/develop"]) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", branch, commitHash],
        { cwd: projectRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      return true;
    } catch {
      // not reachable from this branch
    }
  }
  return false;
}

// ── Local graph ───────────────────────────────────────────────────────────────

function loadLocalCommit(projectRoot) {
  const graphPath = join(projectRoot, UA_DIR, GRAPH_FILE);
  if (!existsSync(graphPath)) {
    return null;
  }
  try {
    const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
    return graph.project?.gitCommitHash ?? null;
  } catch {
    return null;
  }
}

// ── Neo4j ─────────────────────────────────────────────────────────────────────

/**
 * Query Neo4j for the Project singleton's gitCommitHash.
 * Returns null if Neo4j is unavailable or the node doesn't exist yet.
 *
 * TEST MOCK: If CHECK_SYNC_MOCK_NEO4J_COMMIT is set in the environment, it
 * is used as the Neo4j commit hash directly, bypassing the driver call.
 * This allows tests to simulate Neo4j responses without a real database.
 */
async function loadNeo4jCommit(neo4jConfig) {
  // Allow test override via environment variable
  if (process.env.CHECK_SYNC_MOCK_NEO4J_COMMIT !== undefined) {
    const val = process.env.CHECK_SYNC_MOCK_NEO4J_COMMIT;
    return val === "" ? null : val;
  }

  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  // Dynamically import neo4j-driver (optional dependency)
  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch {
    return null; // neo4j-driver not available — skip Neo4j check
  }

  try {
    const session = driver.session();
    const result = await session.run(
      `MATCH (p:Project {id: $id}) RETURN p.gitCommitHash AS gitCommitHash`,
      { id: PROJECT_SINGLETON_ID },
    );
    await session.close();
    const record = result.records[0];
    return record ? (record.get("gitCommitHash") ?? null) : null;
  } catch {
    return null;
  } finally {
    await driver.close();
  }
}

/**
 * Try to get Neo4j config from environment or .env file.
 *
 * TEST MOCK: If CHECK_SYNC_MOCK_NEO4J_COMMIT is set, return a minimal config
 * so the Neo4j query path is entered (loadNeo4jCommit reads the mock env var).
 */
function getNeo4jConfig() {
  // Test override — allow CHECK_SYNC_MOCK_NEO4J_COMMIT alone to enable the mock
  if (process.env.CHECK_SYNC_MOCK_NEO4J_COMMIT !== undefined) {
    return {
      NEO4J_URI: process.env.NEO4J_URI || "neo4j://localhost:7687",
      NEO4J_USERNAME: process.env.NEO4J_USERNAME || "neo4j",
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "password",
    };
  }

  // First check environment variables
  if (process.env.NEO4J_URI && process.env.NEO4J_USERNAME) {
    return {
      NEO4J_URI: process.env.NEO4J_URI,
      NEO4J_USERNAME: process.env.NEO4J_USERNAME,
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "password",
    };
  }

  // Try .env in project root
  const envPath = join(process.cwd(), ".env");
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

// ── Main ──────────────────────────────────────────────────────────────────────

const projectRoot = process.argv[2] || process.cwd();

// Ensure .grasp-it directory exists (create if missing, for fresh project scenarios)
mkdirSync(join(projectRoot, UA_DIR), { recursive: true });

// 1. Load local commit from knowledge-graph.json
const localCommit = loadLocalCommit(projectRoot);
if (!localCommit) {
  console.error(
    "Error: No local graph found at .grasp-it/knowledge-graph.json. Run `/grasp` first.",
  );
  process.exit(4);
}

// 2. Load Neo4j commit
const neo4jConfig = getNeo4jConfig();
let neo4jCommit = null;
if (neo4jConfig) {
  neo4jCommit = await loadNeo4jCommit(neo4jConfig);
}

// 3. No Neo4j analysis yet
if (neo4jCommit === null) {
  console.log("Status: Neo4j has no analysis yet.");
  console.log("Action: Run `/grasp` to initialize the graph in Neo4j.");
  process.exit(3);
}

// 4. In sync
if (localCommit === neo4jCommit) {
  console.log("Status: In sync");
  console.log(`  Local:  ${localCommit}`);
  console.log(`  Neo4j:  ${neo4jCommit}`);
  process.exit(0);
}

// 5. Determine ancestry
const localIsBehind = isAncestor(projectRoot, localCommit, neo4jCommit);
const localIsAhead = isAncestor(projectRoot, neo4jCommit, localCommit);

if (localIsBehind) {
  console.log("Status: Local is behind Neo4j");
  console.log(`  Local:  ${localCommit}`);
  console.log(`  Neo4j:  ${neo4jCommit}`);
  console.log("Action: Pull by running `/grasp` to update your local graph.");
  process.exit(0);
}

if (localIsAhead) {
  const onTracked = isOnTrackedBranch(projectRoot, localCommit);
  console.log("Status: Local is ahead of Neo4j");
  console.log(`  Local:  ${localCommit}`);
  console.log(`  Neo4j:  ${neo4jCommit}`);
  if (onTracked) {
    console.log(
      "Action: Safe to update Neo4j — local is on a tracked branch. Run `/grasp` to push your analysis.",
    );
    process.exit(1);
  } else {
    console.log(
      "Warning: Local is on a feature branch — Neo4j will not be updated until this branch is merged.",
    );
    process.exit(2);
  }
}

// 6. Diverged
console.log("Status: Diverged — local and Neo4j are on different branches");
console.log(`  Local:  ${localCommit}`);
console.log(`  Neo4j:  ${neo4jCommit}`);
console.log("Action: Manual resolution required. Consider rebasing or merging.");
process.exit(2);