import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function initGitRepo(root) {
  const { execSync } = require('child_process');
  execSync('git init', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  writeFileSync(join(root, 'README.md'), 'test');
  execSync('git add .', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
}

// ── Config loaders under test ────────────────────────────────────────────────
// Both grasp and grasp-domain ship identical copies of neo4j-config-loader.mjs.

const LOADERS = [
  {
    name: 'grasp',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/neo4j-config-loader.mjs'),
  },
  {
    name: 'grasp-domain',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/neo4j-config-loader.mjs'),
  },
];

function runConfigLoader(scriptPath, projectRoot, env = {}) {
  // Write a temporary driver script that imports and calls getNeo4jConfig
  const tmpDir = mkdtempSync(join(tmpdir(), 'n4j-cfg-test-'));
  const driverPath = join(tmpDir, 'driver.mjs');
  const driverCode = `
import { getNeo4jConfig } from ${JSON.stringify(scriptPath)};
const config = getNeo4jConfig(${JSON.stringify(projectRoot)});
process.stdout.write(JSON.stringify(config));
`;
  writeFileSync(driverPath, driverCode);

  const result = spawnSync('node', [driverPath], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });

  rmSync(tmpDir, { recursive: true, force: true });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Script failed');
  }
  return JSON.parse(result.stdout);
}

// ── Shared test suite — runs against every loader copy ─────────────────────

describe.each(LOADERS)('neo4j-config-loader.mjs [$name]', ({ path: LOADER_PATH }) => {

  describe('NEO4J_DATABASE from environment variable', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'cfg-env-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('reads NEO4J_DATABASE from env var when NEO4J_URI and NEO4J_USERNAME are set', () => {
      const config = runConfigLoader(LOADER_PATH, root, {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'customdb',
      });
      expect(config.NEO4J_DATABASE).toBe('customdb');
    });

    it('defaults to "neo4j" when NEO4J_DATABASE env var is not set', () => {
      const config = runConfigLoader(LOADER_PATH, root, {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
      });
      expect(config.NEO4J_DATABASE).toBe('neo4j');
    });
  });

  describe('NEO4J_DATABASE from project .env file', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'cfg-project-env-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('reads NEO4J_DATABASE from project .env file', () => {
      writeFileSync(join(root, '.env'),
        `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=neo4j\nNEO4J_PASSWORD=password\nNEO4J_DATABASE=projectdb\n`
      );
      const config = runConfigLoader(LOADER_PATH, root, {});
      expect(config.NEO4J_DATABASE).toBe('projectdb');
    });

    it('defaults to "neo4j" when NEO4J_DATABASE is not in project .env', () => {
      writeFileSync(join(root, '.env'),
        `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=neo4j\nNEO4J_PASSWORD=password\n`
      );
      const config = runConfigLoader(LOADER_PATH, root, {});
      expect(config.NEO4J_DATABASE).toBe('neo4j');
    });
  });

  describe('NEO4J_DATABASE from global ~/.grasp-it/neo4j.env', () => {
    let globalConfigPath;
    const testMarker = `grasp-it-test-${Date.now()}`;

    beforeEach(() => {
      // Create global config in the actual home directory
      // os.homedir() on macOS does not respect HOME env var, so we must use the real path
      const globalDir = join(homedir(), '.grasp-it');
      mkdirSync(globalDir, { recursive: true });
      globalConfigPath = join(globalDir, 'neo4j.env');
    });

    afterEach(() => {
      if (globalConfigPath) {
        try {
          // Only remove if it contains our test marker to avoid destroying real configs
          const content = readFileSync(globalConfigPath, 'utf-8');
          if (content.includes(testMarker)) {
            rmSync(globalConfigPath, { force: true });
          }
        } catch { /* ignore */ }
      }
    });

    it('reads NEO4J_DATABASE from global neo4j.env file', () => {
      writeFileSync(globalConfigPath,
        `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=neo4j\nNEO4J_PASSWORD=password\nNEO4J_DATABASE=globaldb\n${testMarker}\n`
      );
      const projectRoot = mkdtempSync(join(tmpdir(), 'cfg-global-project-'));
      try {
        const config = runConfigLoader(LOADER_PATH, projectRoot, {});
        expect(config.NEO4J_DATABASE).toBe('globaldb');
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('defaults to "neo4j" when NEO4J_DATABASE is not in global neo4j.env', () => {
      writeFileSync(globalConfigPath,
        `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=neo4j\nNEO4J_PASSWORD=password\n${testMarker}\n`
      );
      const projectRoot = mkdtempSync(join(tmpdir(), 'cfg-global-project-'));
      try {
        const config = runConfigLoader(LOADER_PATH, projectRoot, {});
        expect(config.NEO4J_DATABASE).toBe('neo4j');
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  });

  describe('default value when no NEO4J_DATABASE specified', () => {
    let root;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'cfg-default-'));
      initGitRepo(root);
    });

    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('defaults to "neo4j" when NEO4J_DATABASE is not set anywhere', () => {
      const config = runConfigLoader(LOADER_PATH, root, {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
      });
      expect(config.NEO4J_DATABASE).toBe('neo4j');
    });
  });

});