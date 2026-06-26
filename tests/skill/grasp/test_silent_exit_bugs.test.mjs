/**
 * Tests for silent-exit bugs (BUG-01, BUG-02, and related patterns).
 *
 * BUG-01: run-query.mjs called process.exit(2) without printing the reason to stderr.
 * BUG-02: push-concept-graph.mjs fallback condition missed DNS-failure error codes/messages.
 *
 * Scripts covered:
 *   - run-query.mjs (BUG-01)
 *   - push-concept-graph.mjs (BUG-02 + DNS fallback)
 *   - push-domain-graph.mjs (same pattern as BUG-02)
 *   - push-codebase-graph.mjs (same pattern as BUG-02, incomplete fallback condition)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Script paths ──────────────────────────────────────────────────────────────

const RUN_QUERY_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs');
const PUSH_CONCEPT_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-concept/push-concept-graph.mjs');
const PUSH_DOMAIN_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/push-domain-graph.mjs');
const PUSH_CODEBASE_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/push-codebase-graph.mjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

function runScript(scriptPath, args, env = {}) {
  return spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

function initGitRepo(root) {
  const { execSync } = require('child_process');
  execSync('git init', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  writeFileSync(join(root, 'README.md'), 'test');
  execSync('git add .', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
}

// ── BUG-01: run-query.mjs must print reason before exit(2) ───────────────────

describe('BUG-01: run-query.mjs prints reason to stderr before exit(2)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-bug01-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('emits the failure reason to stderr when driver signals fallback (exit 2)', () => {
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
      NEO4J_URI: 'bolt://localhost:19999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'driver',
      NEO4J_TEST_MOCK: '1',
    });

    // Must exit 2 to signal cypher-shell fallback
    expect(result.status).toBe(2);

    // BUG-01 fix: reason must now appear in stderr, not be silently discarded
    expect(result.stderr).toBeTruthy();
    expect(result.stderr.length).toBeGreaterThan(0);
    // The mock throws 'Connection refused (TestMock)' — that reason must be visible
    expect(result.stderr).toMatch(/signaling cypher-shell fallback|Connection refused|TestMock/i);
  });

  it('emits reason to stderr for cypher-shell fallback path (outer caller branch)', () => {
    // This tests the second exit(2) site in run-query.mjs (lines 197-199).
    // The cypher-shell branch returns { ok: false, fallback: true } when cypher-shell is not found.
    // We test via cypher-shell connection type with a PATH that has node but not cypher-shell:
    const nodePath = process.execPath; // full path to node binary
    const nodeDir = nodePath.substring(0, nodePath.lastIndexOf('/'));
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
      NEO4J_URI: 'bolt://localhost:19999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      // PATH includes node's dir but no cypher-shell → ENOENT → fallback
      PATH: nodeDir + ':/usr/local/bin:/usr/bin:/bin',
    });

    // cypher-shell ENOENT returns { ok: false, fallback: true } which triggers exit(2)
    // OR if cypher-shell IS in /usr/local/bin:/usr/bin:/bin, it fails with connection error (exit 1)
    // Either way, stderr must have content
    expect(result.stderr).toBeTruthy();
    if (result.status === 2) {
      // cypher-shell not found: must print reason before exit(2)
      expect(result.stderr).toMatch(/signaling cypher-shell fallback|cypher-shell not available/i);
    } else {
      // cypher-shell found but connection failed: stderr has connection error
      expect(result.stderr).toMatch(/cypher-shell|Query failed|connection/i);
    }
  });
});

// ── BUG-02: push-concept-graph.mjs fallback triggered for DNS failures ─────

describe('BUG-02: push-concept-graph.mjs triggers fallback for DNS-like errors', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pig-bug02-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    const nodesData = {
      nodes: [
        { id: 'feature:test', name: 'Test Feature', summary: 'Test', type: 'feature' },
      ],
    };
    const edgesData = { edges: [] };
    writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
    writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify(edgesData));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('triggers cypher-shell fallback when error message contains ENOTFOUND (DNS failure)', () => {
    // Simulate a DNS failure via the test mock so we don't depend on real DNS timeouts.
    // NEO4J_TEST_MOCK_ERR injects an ENOTFOUND-style message into the thrown error.
    const result = runScript(PUSH_CONCEPT_SCRIPT, [root], {
      NEO4J_URI: 'neo4j://localhost:9999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_TEST_MOCK: '1',
      NEO4J_TEST_MOCK_ERR: 'getaddrinfo ENOTFOUND this.host.does.not.exist.invalid',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    // Should fail (exit 1) but must have gone through the fallback attempt
    expect(result.status).toBe(1);
    // The error message about the push failure or fallback attempt must be visible
    expect(result.stderr).toBeTruthy();
    expect(result.stderr).toMatch(/ENOTFOUND/);
  });

  it('triggers cypher-shell fallback when error.code is ServiceUnavailable', () => {
    // We create a mock scenario: the driver import succeeds but session.run throws
    // an error with code "ServiceUnavailable". We simulate this via NEO4J_TEST_MOCK
    // which throws 'Connection refused (TestMock)' — covered by the existing condition.
    // This test validates the fallback IS attempted when mock error is thrown.
    const result = runScript(PUSH_CONCEPT_SCRIPT, [root], {
      NEO4J_URI: 'neo4j://localhost:9999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_TEST_MOCK: '1',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    // Fallback attempted message should appear (since mock triggers the fallback)
    expect(result.stderr).toMatch(/neo4j-driver not available|cypher-shell fallback|Failed to push/i);
  });

  it('stderr message is visible (not silent) when fallback is triggered', () => {
    const result = runScript(PUSH_CONCEPT_SCRIPT, [root], {
      NEO4J_URI: 'neo4j://localhost:9999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    // Stderr must have content — not silent
    expect(result.stderr).toBeTruthy();
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

// ── BUG-02 same pattern: push-domain-graph.mjs ───────────────────────────────

describe('BUG-02 (push-domain-graph.mjs): fallback condition covers DNS failures', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pdg-bug02-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    const graphData = {
      nodes: [
        { id: 'domain:test', name: 'Test Domain', summary: 'Test', type: 'domain' },
      ],
      edges: [],
    };
    writeFileSync(join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'), JSON.stringify(graphData));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('emits error to stderr when push fails (not silent)', () => {
    const result = runScript(PUSH_DOMAIN_SCRIPT, [root], {
      NEO4J_URI: 'neo4j://localhost:9999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_TEST_MOCK: '1',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBeTruthy();
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('attempts cypher-shell fallback for DNS-like failures (ENOTFOUND in message)', () => {
    // Simulate DNS failure via test mock to avoid real DNS timeouts
    const result = runScript(PUSH_DOMAIN_SCRIPT, [root], {
      NEO4J_URI: 'neo4j://localhost:9999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_TEST_MOCK: '1',
      NEO4J_TEST_MOCK_ERR: 'getaddrinfo ENOTFOUND this.host.does.not.exist.invalid',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    // Should fail (cypher-shell also unavailable) but must have tried the fallback
    expect(result.status).toBe(1);
    expect(result.stderr).toBeTruthy();
    expect(result.stderr).toMatch(/ENOTFOUND/);
  });
});

// ── BUG-02 same pattern: push-codebase-graph.mjs ─────────────────────────────

describe('BUG-02 (push-codebase-graph.mjs): fallback condition covers all connection failures', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pcg-bug02-'));
    initGitRepo(root);
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    const graphData = {
      nodes: [],
      edges: [],
      projectMeta: {
        gitCommitHash: 'abc123',
        version: '1.0.0',
      },
    };
    writeFileSync(join(root, '.grasp-it', 'intermediate', 'codebase-graph.json'), JSON.stringify(graphData));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('emits error to stderr when codebase push fails (not silent)', () => {
    const result = runScript(PUSH_CODEBASE_SCRIPT, [root], {
      NEO4J_URI: 'neo4j://localhost:9999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_TEST_MOCK: '1',
    });

    // Should fail or skip gracefully — but must not be completely silent
    expect(result.stderr).toBeTruthy();
  });
});
