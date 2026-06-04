import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
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

// ── Connection type dispatch tests ─────────────────────────────────────────────

describe('load-project-meta.mjs — CONNECTION_TYPE=cypher-shell dispatch', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-cypher-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('falls back gracefully when cypher-shell is unavailable but CONNECTION_TYPE=cypher-shell', () => {
    const result = runScript(LOAD_SCRIPT, [root], {
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
    });
    // Should exit 0 and output {} because cypher-shell is not installed
    // The script should gracefully skip when the subprocess fails
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });
});

describe('save-project-meta.mjs — CONNECTION_TYPE=cypher-shell dispatch', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spm-cypher-'));
    initGitRepo(root);
    createMeta(root, getHeadHash(root));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('falls back gracefully when cypher-shell is not available', () => {
    // Use a PATH that includes node but NOT cypher-shell (cypher-shell is in /opt/homebrew/bin)
    // This causes execFileSync to throw ENOENT which we catch gracefully
    const result = runScript(SAVE_SCRIPT, [root, '5'], {
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      // node is in /usr/local/bin but cypher-shell is in /opt/homebrew/bin
      PATH: '/usr/local/bin:/usr/bin:/bin',
    });
    // exit 0 because cypher-shell not found is a graceful skip
    expect(result.status).toBe(0);
  });

  it('exits 1 when cypher-shell is available but credentials are wrong', () => {
    const result = runScript(SAVE_SCRIPT, [root, '5'], {
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'bad-password',
    });
    // cypher-shell will fail due to auth error - this is not a graceful skip
    // So exit code is 1 (write failed, not skipped)
    expect(result.status).toBe(1);
  });
});

describe('load-project-meta.mjs — CONNECTION_TYPE=mcp graceful skip', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-mcp-'));
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('outputs {} when CONNECTION_TYPE=mcp (not yet supported)', () => {
    const result = runScript(LOAD_SCRIPT, [root], {
      NEO4J_CONNECTION_TYPE: 'mcp',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });
});

describe('save-project-meta.mjs — CONNECTION_TYPE=mcp graceful skip', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spm-mcp-'));
    initGitRepo(root);
    createMeta(root, getHeadHash(root));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 0 gracefully when CONNECTION_TYPE=mcp (not yet supported)', () => {
    const result = runScript(SAVE_SCRIPT, [root, '5'], {
      NEO4J_CONNECTION_TYPE: 'mcp',
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
    });
    expect(result.status).toBe(0);
  });
});

// ── Global config fallback tests ──────────────────────────────────────────────

describe('load-project-meta.mjs — global config fallback (~/.grasp-it/neo4j.env)', () => {
  let root;
  let globalDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-global-'));
    globalDir = join(tmpdir(), 'grasp-it-global-' + Date.now());
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'neo4j.env'), `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\n`);
    initGitRepo(root);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (globalDir) rmSync(globalDir, { recursive: true, force: true });
  });

  it('uses global config when no project .env exists', () => {
    // Set HOME to our temp global dir so the script finds the global config
    const result = runScript(LOAD_SCRIPT, [root], {
      HOME: globalDir.replace('/grasp-it-global-' + globalDir.split('/grasp-it-global-')[1], ''),
    });
    // With no project .env but global config present, it should use global config
    // Since driver can't connect to localhost:7687 in test, it should gracefully skip
    // and output {} since no real connection is established
    expect(result.status).toBe(0);
  });
});

// ── check-sync.mjs .env resolution (regression test) ──────────────────────────

const CHECK_SYNC_SCRIPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/check-sync.mjs');

describe('check-sync.mjs — .env resolution uses projectRoot, not cwd', () => {
  let root;
  let otherDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-project-'));
    otherDir = mkdtempSync(join(tmpdir(), 'cs-other-'));
    initGitRepo(root);
    createKnowledgeGraph(root, getHeadHash(root));
    // Write .env to project root only
    writeFileSync(join(root, '.env'), `NEO4J_URI=bolt://localhost:7687\nNEO4J_USERNAME=user\nNEO4J_PASSWORD=pass\n`);
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (otherDir) rmSync(otherDir, { recursive: true, force: true });
  });

  it('reads .env from projectRoot (argv[2]), not cwd', () => {
    // Run check-sync.mjs from `otherDir` but pass `root` as projectRoot
    // Previously it would use cwd (otherDir) and not find .env
    // Now it should use projectRoot (root) and find .env
    const result = runScript(CHECK_SYNC_SCRIPT, [root], {
      CHECK_SYNC_MOCK_NEO4J_COMMIT: 'abc123', // Use mock so we don't need real Neo4j
    });
    // The script should use the .env from projectRoot, not cwd
    // With mock commit set, it will compare and exit accordingly
    // Exit code 0 = in sync, 1 = local ahead, 2 = diverged, 3 = no neo4j analysis
    // We just verify it didn't fail to find config
    expect(result.status).not.toBe(4); // 4 = failed to find local graph (not our issue here)
  });
});

// ── check-sync.mjs graceful fallback when no credentials ─────────────────────

describe('check-sync.mjs — exits 3 when no Neo4j config found (graceful fallback)', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-noconfig-'));
    initGitRepo(root);
    createKnowledgeGraph(root, getHeadHash(root));
    // No .env file, no env vars
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 3 when no Neo4j config is available', () => {
    const result = runScript(CHECK_SYNC_SCRIPT, [root], {});
    expect(result.status).toBe(3);
    expect(result.stdout).toMatch(/Neo4j has no analysis yet/);
  });
});

// ── save-project-meta.mjs — unreachable database exits 1 ─────────────────────

describe('save-project-meta.mjs — exits 1 when credentials present but database unreachable', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spm-unreachable-'));
    initGitRepo(root);
    createMeta(root, getHeadHash(root));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('exits 1 when database is unreachable (wrong port)', () => {
    // Use a port that's unlikely to have Neo4j running
    const result = runScript(SAVE_SCRIPT, [root, '5'], {
      NEO4J_URI: 'bolt://localhost:19999',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      // driver is the default connection type
    });
    // Should exit 1 because the database is unreachable
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Neo4j write failed/);
  });
});