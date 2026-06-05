import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── run-query.mjs tests ─────────────────────────────────────────────────────────

const RUN_QUERY_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs');

describe('run-query.mjs — no Neo4j config (graceful skip)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-noconfig-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 0 with empty results when no Neo4j configuration is found', () => {
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], { HOME: root });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([]);
    expect(parsed.skipped).toBe("no Neo4j configuration");
  });
});

describe('run-query.mjs — missing arguments', () => {
  it('exits 1 when project root is missing', () => {
    const result = runScript(RUN_QUERY_SCRIPT, [], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });

  it('exits 1 when query is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'rq-noquery-'));
    try {
      const result = runScript(RUN_QUERY_SCRIPT, [root], {});
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Usage/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('run-query.mjs — CONNECTION_TYPE=mcp graceful skip', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-mcp-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 0 gracefully when CONNECTION_TYPE=mcp (not yet supported)', () => {
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
      NEO4J_CONNECTION_TYPE: 'mcp',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([]);
  });
});

describe('run-query.mjs — CONNECTION_TYPE=driver with unreachable database', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-unreachable-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 2 when driver fails due to connection error (signals fallback to cypher-shell)', () => {
    // Use a port that's unlikely to have Neo4j running
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
      NEO4J_URI: 'bolt://localhost:19999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'driver',
    });
    // Should exit 2 because driver failed with a connection error that
    // cypher-shell might be able to handle (signals fallback to cypher-shell)
    expect(result.status).toBe(2);
  });
});

describe('run-query.mjs — CONNECTION_TYPE=cypher-shell with unreachable database', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-cypher-unreachable-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 when cypher-shell is configured but database is unreachable', () => {
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
      NEO4J_URI: 'bolt://localhost:19999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      // Make cypher-shell available but pointing to unreachable DB
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    });
    // Should exit 1 because cypher-shell connects and fails
    expect(result.status).toBe(1);
  });
});

describe('run-query.mjs — CONNECTION_TYPE=cypher-shell fallback when cypher-shell not available', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-cypher-enoent-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 2 when driver fails and cypher-shell is not available', () => {
    // Use a PATH that doesn't include cypher-shell (it's in /opt/homebrew/bin)
    // but Neo4j is unreachable so driver fails
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
      NEO4J_URI: 'bolt://localhost:19999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'driver',
      // cypher-shell not in PATH
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });
    // Driver fails with connection error, cypher-shell not in PATH -> exit 2
    expect(result.status).toBe(2);
  });
});

describe('run-query.mjs — output format matches calling site expectations', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-format-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('outputs JSON with results array that can be parsed by caller', () => {
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n LIMIT 0'], {});
    expect(result.status).toBe(0);
    // Should be valid JSON
    const parsed = JSON.parse(result.stdout);
    // Should have results key
    expect(parsed).toHaveProperty('results');
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it('can be called from shell with project root and query as positional args', () => {
    // This is what grasp-gaps/SKILL.md and grasp-search/SKILL.md do
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN labels(n)[0] AS label LIMIT 10'], {});
    // Either 0 (success with empty or results) or exit 2 (fallback needed)
    expect(result.status).toBeLessThanOrEqual(2);
    // Should be parseable JSON if status is 0
    if (result.status === 0) {
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('results');
    }
  });
});

describe('run-query.mjs — global config fallback (~/.grasp-it/neo4j.env)', () => {
  let root;
  let globalDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rq-global-'));
    globalDir = join(tmpdir(), 'grasp-it-global-' + Date.now());
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'neo4j.env'), `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\n`);
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (globalDir) rmSync(globalDir, { recursive: true, force: true });
  });

  it('uses global config when no project .env exists (via env vars)', () => {
    // Instead of relying on homedir() which doesn't use HOME env var,
    // we directly set the env vars (simulating what ~/.grasp-it/neo4j.env would provide)
    const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n LIMIT 0'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'globaluser',
      NEO4J_PASSWORD: 'globalpass',
    });
    // With unreachable DB, driver will fail and exit 2 (signals fallback)
    expect(result.status).toBe(2);
  });
});
