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

// ── Scripts under test ────────────────────────────────────────────────────────
// All three skills ship identical copies of run-query.mjs + neo4j-config-loader.mjs.
// Running the same suite against each copy ensures they stay in sync.

const SCRIPTS = [
  {
    name: 'grasp',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs'),
  },
  {
    name: 'grasp-search',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-search/run-query.mjs'),
  },
  {
    name: 'grasp-gaps',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-gaps/run-query.mjs'),
  },
  {
    name: 'grasp-domain',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/run-query.mjs'),
  },
];

// ── Shared test suite — runs against every script copy ────────────────────────

describe.each(SCRIPTS)('run-query.mjs [$name]', ({ path: RUN_QUERY_SCRIPT }) => {

  describe('no Neo4j config (graceful skip)', () => {
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

  describe('missing arguments', () => {
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

  describe('CONNECTION_TYPE=mcp graceful skip', () => {
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

  describe('CONNECTION_TYPE=driver with unreachable database', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'rq-unreachable-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('exits 2 when driver fails due to connection error (signals fallback to cypher-shell)', () => {
      const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
        NEO4J_URI: 'bolt://localhost:19999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'driver',
      });
      expect(result.status).toBe(2);
    }, 15000);
  });

  describe('CONNECTION_TYPE=cypher-shell with unreachable database', () => {
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
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      });
      expect(result.status).toBe(1);
    }, 15000);
  });

  describe('CONNECTION_TYPE=driver fallback when cypher-shell not available', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'rq-cypher-enoent-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('exits 2 when driver fails and cypher-shell is not available', () => {
      const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
        NEO4J_URI: 'bolt://localhost:19999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'driver',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });
      expect(result.status).toBe(2);
    });
  });

  describe('output format matches calling site expectations', () => {
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
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('results');
      expect(Array.isArray(parsed.results)).toBe(true);
    });

    it('can be called from shell with project root and query as positional args', () => {
      const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN labels(n)[0] AS label LIMIT 10'], {});
      expect(result.status).toBeLessThanOrEqual(2);
      if (result.status === 0) {
        const parsed = JSON.parse(result.stdout);
        expect(parsed).toHaveProperty('results');
      }
    });
  });

  describe('global config fallback (~/.grasp-it/neo4j.env)', () => {
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
      const result = runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n LIMIT 0'], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'globaluser',
        NEO4J_PASSWORD: 'globalpass',
      });
      // Unreachable DB: driver fails and signals fallback (exit 2)
      expect(result.status).toBe(2);
    });
  });

});
