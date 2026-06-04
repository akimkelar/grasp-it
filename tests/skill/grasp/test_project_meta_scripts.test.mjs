import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync, execSync } from 'node:child_process';
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
  execSync('git init', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  writeFileSync(join(root, 'README.md'), 'test');
  execSync('git add .', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
}

function getHeadHash(root) {
  return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf-8' }).trim();
}

function createMeta(projectRoot, hash, lastAnalyzedAt = new Date().toISOString()) {
  const dir = join(projectRoot, '.grasp-it');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    lastAnalyzedAt,
    gitCommitHash: hash,
    version: '1.0.0',
    analyzedFiles: 10,
  }));
}

function createKnowledgeGraph(projectRoot, hash) {
  const dir = join(projectRoot, '.grasp-it');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'knowledge-graph.json'), JSON.stringify({
    version: '1.0.0',
    project: {
      name: 'test-project',
      languages: ['typescript'],
      frameworks: [],
      description: 'Test project',
      analyzedAt: new Date().toISOString(),
      gitCommitHash: hash,
    },
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
  }));
}

// ── load-project-meta.mjs tests ────────────────────────────────────────────────

const LOAD_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/load-project-meta.mjs');

describe('load-project-meta.mjs — Neo4j available, Project node exists', () => {
  let root;
  let neo4jHash;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-neo4j-'));
    initGitRepo(root);
    neo4jHash = getHeadHash(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('returns the Neo4j hash when mock env var is set', () => {
    const result = runScript(LOAD_SCRIPT, [root], {
      LOAD_PROJECT_META_MOCK: neo4jHash,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.gitCommitHash).toBe(neo4jHash);
  });
});

describe('load-project-meta.mjs — Neo4j available, no Project node yet', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-empty-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('returns empty object when mock signals no node yet', () => {
    const result = runScript(LOAD_SCRIPT, [root], {
      LOAD_PROJECT_META_MOCK: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });
});

describe('load-project-meta.mjs — no Neo4j config (no .env)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-noconfig-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('returns empty object when no Neo4j configuration is found', () => {
    const result = runScript(LOAD_SCRIPT, [root]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });
});

describe('load-project-meta.mjs — missing project root argument', () => {
  it('exits with error when no project root is provided', () => {
    const result = runScript(LOAD_SCRIPT, [], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });
});

// ── save-project-meta.mjs tests ───────────────────────────────────────────────

const SAVE_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/save-project-meta.mjs');

describe('save-project-meta.mjs — Neo4j mock mode', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spm-mock-'));
    initGitRepo(root);
    createMeta(root, getHeadHash(root));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 0 in mock mode without needing Neo4j', () => {
    const result = runScript(SAVE_SCRIPT, [root, '5'], {
      SAVE_PROJECT_META_MOCK: 'true',
    });
    expect(result.status).toBe(0);
  });
});

describe('save-project-meta.mjs — no Neo4j config (no .env)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spm-noconfig-'));
    initGitRepo(root);
    createMeta(root, getHeadHash(root));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 0 silently when no Neo4j is configured (graceful degradation)', () => {
    const result = runScript(SAVE_SCRIPT, [root, '5'], {});
    expect(result.status).toBe(0);
  });
});

describe('save-project-meta.mjs — meta.json not found', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spm-nometa-'));
    initGitRepo(root);
    // Deliberately NOT creating meta.json
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 when meta.json is missing', () => {
    const result = runScript(SAVE_SCRIPT, [root], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/meta.json not found/);
  });
});

describe('save-project-meta.mjs — missing project root argument', () => {
  it('exits with error when no project root is provided', () => {
    const result = runScript(SAVE_SCRIPT, [], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });
});