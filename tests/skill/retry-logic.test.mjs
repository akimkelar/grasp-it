/**
 * Tests for retry logic added to push-*.mjs scripts.
 *
 * Covers:
 *  - Retry on ENOTFOUND (transient DNS failure): log line appears in stderr
 *  - All 3 retries exhausted → cypher-shell fallback triggered (or exit 1 with DNS message)
 *  - Non-retryable errors (auth failure) do NOT retry
 *  - First attempt fails, second succeeds → exit 0
 *
 * Uses NEO4J_TEST_MOCK_FAIL_TIMES=N to simulate N transient connection failures.
 * After N failures the mock returns successfully without touching Neo4j.
 * Uses NEO4J_TEST_MOCK_AUTH_FAIL=1 to simulate a non-retryable auth failure.
 * Uses NEO4J_RETRY_DELAY_MS=0 to make tests run without actual delays.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PUSH_CONCEPT_SCRIPT = resolve(__dirname, '../../grasp-it-plugin/skills/grasp-concept/push-concept-graph.mjs');
const PUSH_DOMAIN_SCRIPT = resolve(__dirname, '../../grasp-it-plugin/skills/grasp-domain/push-domain-graph.mjs');
const PUSH_CODEBASE_SCRIPT = resolve(__dirname, '../../grasp-it-plugin/skills/grasp/push-codebase-graph.mjs');

const BASE_NEO4J_ENV = {
  NEO4J_URI: 'neo4j://localhost:9997',
  NEO4J_USERNAME: 'neo4j',
  NEO4J_PASSWORD: 'password',
  NEO4J_DATABASE: 'grasp',
  // Use 0ms delay so retry tests finish in milliseconds, not seconds
  NEO4J_RETRY_DELAY_MS: '0',
};

function runScript(scriptPath, projectRoot, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return spawnSync('node', [scriptPath, projectRoot], {
    encoding: 'utf-8',
    env,
    timeout: 15_000,
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function writeConceptFixtures(root) {
  mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'),
    JSON.stringify({ nodes: [{ id: 'feature:test', name: 'Test Feature', summary: 'Test', type: 'feature' }] })
  );
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'pr-edges.json'),
    JSON.stringify({ edges: [] })
  );
}

function writeDomainFixtures(root) {
  mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
    JSON.stringify({
      nodes: [{ id: 'domain:core', name: 'Core', summary: 'Core domain', type: 'domain' }],
      edges: [],
    })
  );
}

function writeCodebaseFixtures(root) {
  mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'assembled-graph.json'),
    JSON.stringify({
      project: { gitCommitHash: 'abc123' },
      version: '1.0.0',
      // Include a node so cypher-shell is called during fallback (needed for fallback tests)
      nodes: [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry' }],
      edges: [],
    })
  );
}

// ── push-concept-graph.mjs retry tests ─────────────────────────────────────

describe('push-concept-graph.mjs — retry logic', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'retry-concept-'));
    writeConceptFixtures(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('logs retry attempt to stderr when ENOTFOUND occurs on first connection attempt', () => {
    // NEO4J_TEST_MOCK_FAIL_TIMES=1 → first attempt throws ENOTFOUND, second succeeds
    const result = runScript(PUSH_CONCEPT_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '1',
    });

    // Retry log line must appear in stderr
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed.*Retrying in 0s/);
    // Script succeeds on second attempt
    expect(result.status).toBe(0);
  });

  it('triggers cypher-shell fallback after all 3 retries exhausted with DNS errors', () => {
    // NEO4J_TEST_MOCK_FAIL_TIMES=10 → all 3 attempts fail with ENOTFOUND (retries cap at 3)
    const result = runScript(PUSH_CONCEPT_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '10',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    // Two retry log lines (attempt 1 and 2 fail, attempt 3 throws and exits)
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed/);
    expect(result.stderr).toMatch(/Connection attempt 2\/3 failed/);
    // DNS diagnostic or fallback message must appear
    expect(result.stderr).toMatch(/DNS resolution failed|cypher-shell fallback|Failed to push/i);
  });

  it('does NOT retry on non-retryable auth failure', () => {
    // NEO4J_TEST_MOCK_AUTH_FAIL=1 → throws auth error which is not retryable
    const result = runScript(PUSH_CONCEPT_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_AUTH_FAIL: '1',
    });

    // Must NOT contain any retry log line
    expect(result.stderr).not.toMatch(/Connection attempt \d+\/3 failed.*Retrying/);
    // Must report the auth failure
    expect(result.stderr).toMatch(/Failed to push concept graph|authentication|unauthorized/i);
  });

  it('exits 0 when first attempt fails but second attempt succeeds', () => {
    // fail_times=1: first attempt throws retryable ENOTFOUND, second returns immediately
    const result = runScript(PUSH_CONCEPT_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '1',
    });

    expect(result.status).toBe(0);
    // Retry log proves first attempt failed and second was made
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed/);
  });
});

// ── push-domain-graph.mjs retry tests ────────────────────────────────────────

describe('push-domain-graph.mjs — retry logic', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'retry-domain-'));
    writeDomainFixtures(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('logs retry attempt to stderr when ENOTFOUND occurs on first connection attempt', () => {
    const result = runScript(PUSH_DOMAIN_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '1',
    });

    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed.*Retrying in 0s/);
    expect(result.status).toBe(0);
  });

  it('triggers cypher-shell fallback after all 3 retries exhausted with DNS errors', () => {
    const result = runScript(PUSH_DOMAIN_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '10',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed/);
    expect(result.stderr).toMatch(/Connection attempt 2\/3 failed/);
    expect(result.stderr).toMatch(/DNS resolution failed|cypher-shell fallback|Failed to push/i);
  });

  it('does NOT retry on non-retryable auth failure', () => {
    const result = runScript(PUSH_DOMAIN_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_AUTH_FAIL: '1',
    });

    expect(result.stderr).not.toMatch(/Connection attempt \d+\/3 failed.*Retrying/);
    expect(result.stderr).toMatch(/Failed to push domain graph|authentication|unauthorized/i);
  });

  it('exits 0 when first attempt fails but second attempt succeeds', () => {
    const result = runScript(PUSH_DOMAIN_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '1',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed/);
  });
});

// ── push-codebase-graph.mjs retry tests ──────────────────────────────────────

describe('push-codebase-graph.mjs — retry logic', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'retry-codebase-'));
    writeCodebaseFixtures(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('logs retry attempt to stderr when ENOTFOUND occurs on first connection attempt', () => {
    const result = runScript(PUSH_CODEBASE_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '1',
    });

    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed.*Retrying in 0s/);
    expect(result.status).toBe(0);
  });

  it('triggers cypher-shell fallback after all 3 retries exhausted with DNS errors', () => {
    const result = runScript(PUSH_CODEBASE_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '10',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed/);
    expect(result.stderr).toMatch(/Connection attempt 2\/3 failed/);
    expect(result.stderr).toMatch(/DNS resolution failed|cypher-shell fallback|Failed to push/i);
  });

  it('does NOT retry on non-retryable auth failure', () => {
    const result = runScript(PUSH_CODEBASE_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_AUTH_FAIL: '1',
    });

    expect(result.stderr).not.toMatch(/Connection attempt \d+\/3 failed.*Retrying/);
    expect(result.stderr).toMatch(/Failed to push codebase graph|authentication|unauthorized/i);
  });

  it('exits 0 when first attempt fails but second attempt succeeds', () => {
    const result = runScript(PUSH_CODEBASE_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_TEST_MOCK_FAIL_TIMES: '1',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Connection attempt 1\/3 failed/);
  });

  it('emits DNS-specific diagnostic message when all retries exhausted with ENOTFOUND', () => {
    const result = runScript(PUSH_CODEBASE_SCRIPT, root, {
      ...BASE_NEO4J_ENV,
      NEO4J_URI: 'neo4j://mydb.example.com:7687',
      NEO4J_TEST_MOCK_FAIL_TIMES: '10',
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });

    expect(result.status).toBe(1);
    // DNS diagnostic must include the hostname and a hint about containers
    expect(result.stderr).toMatch(/DNS resolution failed for mydb\.example\.com/);
    expect(result.stderr).toMatch(/container|sandbox|Codex/i);
    expect(result.stderr).toMatch(/NEO4J_CONNECTION_TYPE=cypher-shell/);
  });
});
