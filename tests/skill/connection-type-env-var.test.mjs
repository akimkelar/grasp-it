/**
 * Tests for NEO4J_CONNECTION_TYPE environment variable handling.
 *
 * Verifies that push-interview-graph.mjs, push-domain-graph.mjs, and
 * push-codebase-graph.mjs route to the correct connection path when
 * NEO4J_CONNECTION_TYPE is set to "cypher-shell" or "driver".
 *
 * When NEO4J_CONNECTION_TYPE=cypher-shell, the script must use cypher-shell
 * directly without attempting the driver first. This is observable because:
 *   - With driver path (default): stderr contains "neo4j-driver not available"
 *     or a driver error before any cypher-shell message.
 *   - With cypher-shell path: stderr goes directly to "cypher-shell node push
 *     failed" or a cypher-shell connection error without any driver message.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run a script with the given project root, extra env vars, and optional
 * additional args appended after projectRoot.
 */
function runScript(scriptPath, projectRoot, extraEnv = {}, extraArgs = []) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return spawnSync('node', [scriptPath, projectRoot, ...extraArgs], {
    encoding: 'utf-8',
    env,
    timeout: 30_000,
  });
}

// Script paths
const PUSH_INTERVIEW_GRAPH = resolve(__dirname, '../../grasp-it-plugin/skills/grasp-interview/push-interview-graph.mjs');
const PUSH_DOMAIN_GRAPH = resolve(__dirname, '../../grasp-it-plugin/skills/grasp-domain/push-domain-graph.mjs');
const PUSH_CODEBASE_GRAPH = resolve(__dirname, '../../grasp-it-plugin/skills/grasp/push-codebase-graph.mjs');
const RUN_QUERY_SCRIPT = resolve(__dirname, '../../grasp-it-plugin/skills/grasp/run-query.mjs');

// Common Neo4j env for all tests — unreachable host so connections always fail fast
const NEO4J_ENV = {
  NEO4J_URI: 'neo4j://localhost:9998',
  NEO4J_USERNAME: 'neo4j',
  NEO4J_PASSWORD: 'password',
  NEO4J_DATABASE: 'grasp',
};

// ── push-interview-graph.mjs ──────────────────────────────────────────────────

describe('NEO4J_CONNECTION_TYPE — push-interview-graph.mjs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conn-type-interview-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    // Write minimal valid graph files
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'),
      JSON.stringify({ nodes: [{ id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature' }] })
    );
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'pr-edges.json'),
      JSON.stringify({ edges: [] })
    );
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('uses cypher-shell directly when NEO4J_CONNECTION_TYPE=cypher-shell (no driver attempt)', () => {
    const result = runScript(PUSH_INTERVIEW_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      // Remove cypher-shell from PATH so the cypher-shell call fails quickly
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    // Must NOT mention "neo4j-driver not available" — driver was never attempted
    expect(result.stderr).not.toContain('neo4j-driver not available');
    // Must go straight to cypher-shell path — error is about cypher-shell failing
    expect(result.stderr).toMatch(/cypher-shell node push failed|cypher-shell/i);
  });

  it('uses driver when NEO4J_CONNECTION_TYPE=driver', () => {
    const result = runScript(PUSH_INTERVIEW_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'driver',
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    // With driver path, the driver error appears first
    expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|neo4j-driver not available/i);
  });

  it('uses driver by default when NEO4J_CONNECTION_TYPE is not set', () => {
    const result = runScript(PUSH_INTERVIEW_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: undefined,
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    // Without connection type set, driver path is attempted first (test mock makes it fail).
    // The "neo4j-driver not available" message proves the driver was tried before cypher-shell.
    expect(result.stderr).toContain('neo4j-driver not available');
  });

  it('with NEO4J_CONNECTION_TYPE=cypher-shell, stderr does not mention driver fallback message', () => {
    // Use real PATH — cypher-shell may or may not exist; driver should never be tried
    const result = runScript(PUSH_INTERVIEW_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
    });

    // Regardless of whether cypher-shell exists, driver should never be attempted
    expect(result.stderr).not.toContain('neo4j-driver not available');
    expect(result.stderr).not.toContain('will use cypher-shell fallback');
  });
});

// ── push-domain-graph.mjs ─────────────────────────────────────────────────────

describe('NEO4J_CONNECTION_TYPE — push-domain-graph.mjs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conn-type-domain-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
      JSON.stringify({
        nodes: [{ id: 'domain:test', name: 'Test Domain', summary: 'Test', type: 'domain' }],
        edges: [],
      })
    );
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('uses cypher-shell directly when NEO4J_CONNECTION_TYPE=cypher-shell (no driver attempt)', () => {
    const result = runScript(PUSH_DOMAIN_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    // Must NOT mention "neo4j-driver not available" — driver was never attempted
    expect(result.stderr).not.toContain('neo4j-driver not available');
    // Must go straight to cypher-shell path — error is about cypher-shell failing
    expect(result.stderr).toMatch(/cypher-shell node push failed|cypher-shell/i);
  });

  it('uses driver when NEO4J_CONNECTION_TYPE=driver', () => {
    const result = runScript(PUSH_DOMAIN_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'driver',
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|neo4j-driver not available/i);
  });

  it('uses driver by default when NEO4J_CONNECTION_TYPE is not set', () => {
    const result = runScript(PUSH_DOMAIN_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: undefined,
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    // Without connection type set, driver path is attempted first (test mock makes it fail).
    // The "neo4j-driver not available" message proves the driver was tried before cypher-shell.
    expect(result.stderr).toContain('neo4j-driver not available');
  });

  it('with NEO4J_CONNECTION_TYPE=cypher-shell, stderr does not mention driver fallback message', () => {
    const result = runScript(PUSH_DOMAIN_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
    });

    expect(result.stderr).not.toContain('neo4j-driver not available');
    expect(result.stderr).not.toContain('will use cypher-shell fallback');
  });
});

// ── push-codebase-graph.mjs ──────────────────────────────────────────────────

describe('NEO4J_CONNECTION_TYPE — push-codebase-graph.mjs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conn-type-codebase-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'assembled-graph.json'),
      JSON.stringify({
        project: { gitCommitHash: 'abc123' },
        version: '1.0.0',
        nodes: [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry point' }],
        edges: [],
      })
    );
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('uses cypher-shell directly when NEO4J_CONNECTION_TYPE=cypher-shell (no driver attempt)', () => {
    const result = runScript(PUSH_CODEBASE_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    // Must NOT mention "neo4j-driver not available" — driver was never attempted
    expect(result.stderr).not.toContain('neo4j-driver not available');
    // Must go straight to cypher-shell path — error is about cypher-shell failing
    expect(result.stderr).toMatch(/cypher-shell node push failed|cypher-shell/i);
  });

  it('uses driver when NEO4J_CONNECTION_TYPE=driver', () => {
    const result = runScript(PUSH_CODEBASE_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'driver',
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Failed to push codebase graph|Connection refused|neo4j-driver not available/i);
  });

  it('uses driver by default when NEO4J_CONNECTION_TYPE is not set', () => {
    const result = runScript(PUSH_CODEBASE_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: undefined,
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    // Without connection type set, driver path is attempted first (test mock makes it fail).
    // The "neo4j-driver not available" message proves the driver was tried before cypher-shell.
    expect(result.stderr).toContain('neo4j-driver not available');
  });

  it('with NEO4J_CONNECTION_TYPE=cypher-shell, stderr does not mention driver fallback message', () => {
    const result = runScript(PUSH_CODEBASE_GRAPH, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
    });

    expect(result.stderr).not.toContain('neo4j-driver not available');
    expect(result.stderr).not.toContain('will use cypher-shell fallback');
  });
});

// ── run-query.mjs — verify already correct behavior ──────────────────────────

describe('NEO4J_CONNECTION_TYPE — run-query.mjs (already correct)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'conn-type-runquery-'));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('uses cypher-shell directly when NEO4J_CONNECTION_TYPE=cypher-shell', () => {
    const result = runScript(RUN_QUERY_SCRIPT, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      // Use restricted PATH so cypher-shell binary is not found
      PATH: '/usr/local/bin:/usr/bin:/bin',
    }, ['MATCH (n) RETURN n']);

    // cypher-shell path was taken — script exits 1 (cypher-shell not found or failed)
    expect([1, 2]).toContain(result.status);
    // Driver was never attempted
    expect(result.stderr).not.toContain('neo4j-driver not available');
  });

  it('uses driver when NEO4J_CONNECTION_TYPE=driver', () => {
    const result = runScript(RUN_QUERY_SCRIPT, root, {
      ...NEO4J_ENV,
      NEO4J_CONNECTION_TYPE: 'driver',
      NEO4J_TEST_MOCK: '1',
    }, ['MATCH (n) RETURN n']);

    // Driver path was attempted (and failed via mock), signaling cypher-shell fallback (exit 2)
    // or failing with exit 1 (connection error)
    expect([1, 2]).toContain(result.status);
  });
});
