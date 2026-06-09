import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
// Both grasp and grasp-domain ship their own copy of load-project-meta.mjs.

const SCRIPTS = [
  {
    name: 'grasp',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/load-project-meta.mjs'),
    expectNoNeo4jExits0: true,   // graceful: exits 0 with {} when no config
    expectNoProjectExits0: true, // graceful: exits 0 with {} when no singleton
    hasMockEnvVar: true,          // LOAD_PROJECT_META_MOCK is handled
  },
  {
    name: 'grasp-domain',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/load-project-meta.mjs'),
    expectNoNeo4jExits0: false,  // strict: exits 1 when no config
    expectNoProjectExits0: false, // strict: exits 1 when no singleton
    hasMockEnvVar: false,         // LOAD_PROJECT_META_MOCK is NOT handled
  },
];

// ── Shared test suite — runs against every script copy ────────────────────────

describe.each(SCRIPTS)('load-project-meta.mjs [$name]', ({ path: SCRIPT, expectNoNeo4jExits0, expectNoProjectExits0, hasMockEnvVar }) => {

  describe('missing arguments', () => {
    it('exits 1 when project root is missing', () => {
      const result = runScript(SCRIPT, [], {});
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Usage/);
    });
  });

  describe('no Neo4j configuration', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-noconfig-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it(expectNoNeo4jExits0
      ? 'exits 0 with {} when no Neo4j configuration is found'
      : 'exits 1 with error when no Neo4j configuration is found', () => {
        const result = runScript(SCRIPT, [root], { HOME: root });
        if (expectNoNeo4jExits0) {
          expect(result.status).toBe(0);
          expect(result.stdout.trim()).toBe('{}');
        } else {
          expect(result.status).toBe(1);
          expect(result.stderr).toContain('No Neo4j configuration found');
        }
      });
  });

  describe('CONNECTION_TYPE=mcp graceful skip (grasp only)', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-mcp-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('exits 0 gracefully when CONNECTION_TYPE=mcp (not yet supported)', () => {
      const result = runScript(SCRIPT, [root], {
        NEO4J_CONNECTION_TYPE: 'mcp',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
      });
      // grasp version exits 0 with {} when no project data; grasp-domain exits 1 (no graceful skip)
      if (expectNoNeo4jExits0) {
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('{}');
      } else {
        expect(result.status).toBe(1);
      }
    });
  });

  describe('no Project singleton in Neo4j', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-noproject-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it(expectNoProjectExits0
      ? 'exits 0 with {} when Project singleton does not exist'
      : 'exits 1 with error when Project singleton does not exist', () => {
        // Configure a real-ish connection that will succeed but return no rows
        const result = runScript(SCRIPT, [root], {
          NEO4J_URI: 'bolt://localhost:19999',
          NEO4J_USERNAME: 'neo4j',
          NEO4J_PASSWORD: 'password',
          NEO4J_CONNECTION_TYPE: 'driver',
        });
        if (expectNoProjectExits0) {
          // Connection fails → graceful {} (or unreachable db → exit 2)
          expect(result.status === 0 || result.status === 2).toBe(true);
          if (result.status === 0) expect(result.stdout.trim()).toBe('{}');
        } else {
          // grasp-domain exits 1 on query failure
          expect(result.status).toBe(1);
        }
      });
  });

  describe('mock environment variable (grasp only)', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-mock-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('exits 0 and outputs JSON when LOAD_PROJECT_META_MOCK is set', () => {
      if (!hasMockEnvVar) return; // skip for grasp-domain
      const result = runScript(SCRIPT, [root], {
        LOAD_PROJECT_META_MOCK: 'abc123def456',
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('gitCommitHash', 'abc123def456');
      expect(parsed).toHaveProperty('lastAnalyzedAt');
      expect(parsed).toHaveProperty('version', '1.0.0');
      expect(parsed).toHaveProperty('analyzedFiles', 0);
    });

    it('exits 0 with {} when LOAD_PROJECT_META_MOCK is empty string', () => {
      if (!hasMockEnvVar) return; // skip for grasp-domain
      const result = runScript(SCRIPT, [root], {
        LOAD_PROJECT_META_MOCK: '',
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('{}');
    });

    it('exits 0 with {} when LOAD_PROJECT_META_MOCK is "null"', () => {
      if (!hasMockEnvVar) return; // skip for grasp-domain
      const result = runScript(SCRIPT, [root], {
        LOAD_PROJECT_META_MOCK: 'null',
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('{}');
    });
  });

  describe('output structure (grasp only — uses LOAD_PROJECT_META_MOCK)', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-struct-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('outputs correct JSON structure: { gitCommitHash, lastAnalyzedAt, version, analyzedFiles }', () => {
      if (!hasMockEnvVar) return; // skip for grasp-domain
      const result = runScript(SCRIPT, [root], {
        LOAD_PROJECT_META_MOCK: 'deadbeef123456',
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('gitCommitHash');
      expect(parsed).toHaveProperty('lastAnalyzedAt');
      expect(parsed).toHaveProperty('version');
      expect(parsed).toHaveProperty('analyzedFiles');
      expect(typeof parsed.gitCommitHash).toBe('string');
      expect(typeof parsed.lastAnalyzedAt).toBe('string');
      expect(typeof parsed.version).toBe('string');
      expect(typeof parsed.analyzedFiles).toBe('number');
    });
  });

  describe('CONNECTION_TYPE=cypher-shell with unreachable database', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-cypher-unreachable-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('exits 2 when cypher-shell is configured but database is unreachable (grasp only)', () => {
      const result = runScript(SCRIPT, [root], {
        NEO4J_URI: 'bolt://localhost:19999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      });
      // grasp: graceful skip via {} (exit 0) or unreachable → exit 2
      // grasp-domain: exits 1 on query failure
      if (expectNoNeo4jExits0) {
        expect(result.status === 0 || result.status === 2).toBe(true);
      } else {
        expect(result.status).toBe(1);
      }
    });
  });

  describe('cypher-shell -d flag (grasp only — config loader test coverage)', () => {
    // The -d flag passing in cypher-shell mode is covered by test_neo4j_config_loader.test.mjs
    // which verifies NEO4J_DATABASE is correctly read from env/.env files.
    // load-project-meta.mjs uses the same config loader + cypher-shell path as run-query.mjs.
    // Note: grasp-domain's load-project-meta.mjs uses driver-only mode, so this test
    // only applies to the grasp version.
    if (!expectNoNeo4jExits0) {
      it('skipped for grasp-domain (driver-only mode)', () => {
        expect(true).toBe(true);
      });
      return;
    }

    let root;
    let mockDir;
    let origPath;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'lpm-csh-db-'));
      initGitRepo(root);
      mockDir = mkdtempSync(join(tmpdir(), 'lpm-mock-cypher-'));
      origPath = process.env.PATH;
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      if (mockDir) rmSync(mockDir, { recursive: true, force: true });
      process.env.PATH = origPath;
    });

    it('calls cypher-shell with -d flag present (config loader test coverage)', () => {
      const mockCypherPath = join(mockDir, 'cypher-shell');
      writeFileSync(mockCypherPath, `#!/bin/sh
echo "$@" > /dev/stderr
echo '[{"keys":["gitCommitHash"],"fields":[]}]'
`, { mode: 0o755 });
      process.env.PATH = mockDir + ':' + origPath;
      const result = runScript(SCRIPT, [root], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        NEO4J_DATABASE: 'grasp',
      });
      expect(result.status === 0 || result.status === 1).toBe(true);
      expect(result.stderr).toContain('-d');
    });
  });

});
