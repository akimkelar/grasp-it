/**
 * Behavioral test: cypher-shell child-process timeout is large enough
 * for bulk pushes.
 *
 * Regression: push-codebase-graph.mjs previously hardcoded
 * `execFileSync(..., { timeout: 10_000 })` for every cypher-shell call.
 * Bulk pushes (hundreds of MERGE statements) running against a remote
 * Neo4j regularly take 10–30s end-to-end. The 10s wall-clock killed
 * cypher-shell mid-transaction, leaving the push script to exit 1.
 *
 * This test installs a fake `cypher-shell` that sleeps 11 seconds, then
 * runs the push script end-to-end with `NEO4J_CONNECTION_TYPE=cypher-shell`.
 * If the script's timeout is still 10s, execFileSync throws ETIMEDOUT and
 * the script exits non-zero. With the fix, the mock completes in 11s and
 * the script exits 0.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(
  __dirname,
  "../../../grasp-it-plugin/skills/grasp/push-codebase-graph.mjs",
);

function runPushCodebaseGraph(projectRoot, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) delete env[key];
    else env[key] = val;
  }
  return spawnSync("node", [SCRIPT_PATH, projectRoot], {
    encoding: "utf-8",
    env,
    timeout: 60_000,
  });
}

describe("push-codebase-graph.mjs — cypher-shell timeout", () => {
  let root;
  let mockDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "push-timeout-"));
    mkdirSync(join(root, ".grasp-it", "intermediate"), { recursive: true });
    writeFileSync(
      join(root, ".grasp-it", "intermediate", "assembled-graph.json"),
      JSON.stringify({
        project: { gitCommitHash: "abc123" },
        version: "1.0.0",
        nodes: [
          {
            id: "file:src/index.ts",
            name: "index.ts",
            type: "file",
            summary: "Entry point",
            tags: [],
          },
        ],
        edges: [],
      }),
    );

    // Mock cypher-shell sleeps 11s — strictly longer than the old 10s timeout.
    // It exits 0 on completion, so the push should succeed when timeout is large.
    mockDir = mkdtempSync(join(tmpdir(), "mock-slow-cypher-"));
    writeFileSync(
      join(mockDir, "cypher-shell"),
      `#!/bin/sh\nsleep 11\nexit 0\n`,
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
  });

  it("does not kill cypher-shell for pushes that take longer than 10s", () => {
    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
      NEO4J_CONNECTION_TYPE: "cypher-shell",
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    // With the old 10s timeout: execFileSync would throw ETIMEDOUT and the
    // script would print "Command failed: ... ETIMEDOUT ..." and exit 1.
    // With a >= 11s timeout: the mock completes cleanly and the script exits 0.
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/ETIMEDOUT|timeout exceeded/i);
  }, 30_000);
});
