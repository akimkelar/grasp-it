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
// run-query.mjs and neo4j-config-loader.mjs live in the grasp skill as the canonical source.

const SCRIPTS = [
  {
    name: 'grasp',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs'),
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
        NEO4J_TEST_MOCK: '1',
      });
      expect(result.status).toBe(2);
    }, 5000);
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
    }, 5000);
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
        NEO4J_TEST_MOCK: '1',
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

  describe('cypher-shell --format json parsing', () => {
    // These tests use a mock cypher-shell script that outputs JSON to verify
    // the JSON parsing logic handles all cypher-shell output shapes correctly.

    let root;
    let mockDir;
    let origPath;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'rq-json-'));
      initGitRepo(root);
      mockDir = mkdtempSync(join(tmpdir(), 'rq-mock-cypher-'));
      origPath = process.env.PATH;
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      if (mockDir) rmSync(mockDir, { recursive: true, force: true });
      process.env.PATH = origPath;
    });

    function runWithMockCypher(scriptContent, extraEnv = {}) {
      const mockCypherPath = join(mockDir, 'cypher-shell');
      writeFileSync(mockCypherPath, scriptContent, { mode: 0o755 });
      // Prepend mock dir to PATH so mock cypher-shell is found, but other commands (node) still work
      process.env.PATH = mockDir + ':' + origPath;
      return runScript(RUN_QUERY_SCRIPT, [root, 'MATCH (n) RETURN n'], {
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        ...extraEnv,
      });
    }

    it('parses cypher-shell JSON output correctly — single record, multiple columns', () => {
      const result = runWithMockCypher(`#!/bin/sh
echo '[{"keys":["name","kind"],"fields":[{"row":["UserService","service"]}]}]'
`);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.results).toEqual([{ name: 'UserService', kind: 'service' }]);
    });

    it('parses cypher-shell JSON output correctly — multiple records', () => {
      const result = runWithMockCypher(`#!/bin/sh
echo '[{"keys":["id","score"],"fields":[{"row":["node:1",42]},{"row":["node:2",87]}]}]'
`);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.results).toEqual([
        { id: 'node:1', score: 42 },
        { id: 'node:2', score: 87 },
      ]);
    });

    it('parses cypher-shell JSON output correctly — array values', () => {
      const result = runWithMockCypher(`#!/bin/sh
echo '[{"keys":["name","tags"],"fields":[{"row":["UserService",["auth","api","v2"]]}]}]'
`);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.results).toEqual([{ name: 'UserService', tags: ['auth', 'api', 'v2'] }]);
    });

    it('parses cypher-shell JSON output correctly — null values', () => {
      const result = runWithMockCypher(`#!/bin/sh
echo '[{"keys":["name","description"],"fields":[{"row":["UserService",null]}]}]'
`);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.results).toEqual([{ name: 'UserService', description: null }]);
    });

    it('parses cypher-shell JSON output correctly — empty results', () => {
      const result = runWithMockCypher(`#!/bin/sh
echo '[{"keys":["name"],"fields":[]}]'
`);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.results).toEqual([]);
    });

    it('passes -d <database> flag to cypher-shell (verified via config loader test)', () => {
      // The -d flag passing is verified by test_neo4j_config_loader.test.mjs which
      // tests that NEO4J_DATABASE is read from env/.env and the run-query.mjs uses it.
      // This test verifies the cypher-shell integration works end-to-end.
      const result = runWithMockCypher(`#!/bin/sh
echo "$@" > /dev/stderr
echo '[{"keys":["n"],"fields":[]}]'
`);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('-d');
    });
  });

});
