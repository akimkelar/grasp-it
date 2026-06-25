/**
 * Comprehensive tests for NEO4J_CONNECTION_TYPE=cypher-shell in:
 *   - push-domain-graph.mjs
 *   - push-concept-graph.mjs
 *
 * Coverage:
 *   - Full push flow (nodes → edges → project-update) via cypher-shell
 *   - Orphan check behavior: ENOENT warning, other errors silently ignored
 *   - IMPLEMENTED_BY edge handling targets :Codebase, not :Knowledge
 *   - Error propagation: node push failure vs edge push failure
 *   - URI conversion (neo4j:// → bolt://, neo4j+s:// → bolt+s://)
 *   - Database flag (-d) passed correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PUSH_DOMAIN = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/push-domain-graph.mjs');
const PUSH_CONCEPT = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-concept/push-concept-graph.mjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run a script with the given args and extra environment variables.
 * undefined values in extraEnv delete the key from the environment.
 */
function runScript(scriptPath, args, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf-8',
    env,
    timeout: 30_000,
  });
}

/**
 * Write a mock cypher-shell script to mockDir.
 * `scriptBody` is the body after `#!/bin/sh\n`.
 */
function writeMockCypherShell(mockDir, scriptBody) {
  const shellPath = join(mockDir, 'cypher-shell');
  writeFileSync(shellPath, `#!/bin/sh\n${scriptBody}`, { mode: 0o755 });
  return shellPath;
}

// ── push-domain-graph.mjs setup helpers ──────────────────────────────────────

function makeDomainRoot() {
  const root = mkdtempSync(join(tmpdir(), 'push-domain-cypher-'));
  mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  return root;
}

function writeDomainGraph(root, nodes = [], edges = []) {
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
    JSON.stringify({ nodes, edges }),
  );
}

const SAMPLE_DOMAIN_NODE = {
  id: 'domain:auth',
  name: 'Authentication',
  type: 'domain',
  summary: 'Handles user authentication',
  tags: ['auth', 'security'],
  generatedAt: '2024-01-01T00:00:00.000Z',
};

const SAMPLE_FEATURE_NODE = {
  id: 'feature:login',
  name: 'Login',
  type: 'feature',
  summary: 'User login flow',
  tags: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
};

const SAMPLE_DOMAIN_EDGE = {
  source: 'domain:auth',
  target: 'feature:login',
  type: 'contains',
  weight: 1.0,
};

const SAMPLE_IMPLEMENTED_BY_EDGE = {
  source: 'feature:login',
  target: 'file:src/auth.ts',
  type: 'IMPLEMENTED_BY',
  weight: 1.0,
};

// ── push-concept-graph.mjs setup helpers ────────────────────────────────────

function makeConceptRoot() {
  const root = mkdtempSync(join(tmpdir(), 'push-concept-cypher-'));
  mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  return root;
}

function writeConceptGraph(root, nodes = [], edges = []) {
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'),
    JSON.stringify({ nodes }),
  );
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'pr-edges.json'),
    JSON.stringify({ edges }),
  );
}

// Aliases preserved from the pre-rename `grasp-interview` skill — same file layout.
// push-concept-graph.mjs reads pr-nodes.json / pr-edges.json regardless of name.
function makeInterviewRoot() {
  return makeConceptRoot();
}

function writeInterviewGraph(root, nodes = [], edges = []) {
  return writeConceptGraph(root, nodes, edges);
}

const SAMPLE_INTERVIEW_NODE = {
  id: 'feature:checkout',
  name: 'Checkout',
  type: 'feature',
  summary: 'User checkout process',
  tags: ['checkout'],
  generatedAt: '2024-01-01T00:00:00.000Z',
  author: 'tester',
};

const SAMPLE_PAYMENT_NODE = {
  id: 'feature:payment',
  name: 'Payment',
  type: 'feature',
  summary: 'Payment processing',
  tags: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  author: 'tester',
};

const SAMPLE_INTERVIEW_EDGE = {
  source: 'feature:checkout',
  target: 'feature:payment',
  type: 'depends_on',
  weight: 1.0,
};

const SAMPLE_INTERVIEW_IMPLEMENTED_BY_EDGE = {
  source: 'feature:checkout',
  target: 'file:src/checkout.ts',
  type: 'IMPLEMENTED_BY',
  weight: 1.0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// push-domain-graph.mjs — cypher-shell tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('push-domain-graph.mjs — NEO4J_CONNECTION_TYPE=cypher-shell', () => {
  let root;
  let mockDir;
  let origPath;

  beforeEach(() => {
    root = makeDomainRoot();
    mockDir = mkdtempSync(join(tmpdir(), 'domain-mock-cypher-'));
    origPath = process.env.PATH;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  function runDomain(extraEnv = {}) {
    return runScript(PUSH_DOMAIN, [root], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
      ...extraEnv,
    });
  }

  // ── Full push flow ──────────────────────────────────────────────────────────

  describe('full push flow', () => {
    it('exits 0 when cypher-shell succeeds for all stages', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE, SAMPLE_FEATURE_NODE], [SAMPLE_DOMAIN_EDGE]);
      writeMockCypherShell(mockDir, 'exit 0');

      const result = runDomain();

      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/cypher-shell successfully/i);
    });

    it('exits 0 with empty graph (no nodes, no edges)', () => {
      writeDomainGraph(root, [], []);
      writeMockCypherShell(mockDir, 'exit 0');

      const result = runDomain();

      // Empty graph: nodes/edges cypher is skipped, project update + orphan check run
      expect(result.status).toBe(0);
    });

    it('invokes cypher-shell with correct database flag', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);
      const logFile = join(root, 'calls.log');
      writeMockCypherShell(mockDir, `echo "$@" >> "${logFile}"\nexit 0`);

      runDomain({ NEO4J_DATABASE: 'mydomaindb' });

      const callLog = readFileSync(logFile, 'utf-8');
      expect(callLog).toContain('-d');
      expect(callLog).toContain('mydomaindb');
    });

    it('invokes cypher-shell with correct username flag', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);
      const logFile = join(root, 'calls.log');
      writeMockCypherShell(mockDir, `echo "$@" >> "${logFile}"\nexit 0`);

      runDomain({ NEO4J_USERNAME: 'admin' });

      const callLog = readFileSync(logFile, 'utf-8');
      expect(callLog).toContain('-u');
      expect(callLog).toContain('admin');
    });
  });

  // ── URI conversion ──────────────────────────────────────────────────────────

  describe('URI conversion', () => {
    it('converts neo4j:// to bolt:// for cypher-shell', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);
      writeMockCypherShell(mockDir, 'echo "$@" >&2\nexit 1');

      const result = runDomain({ NEO4J_URI: 'neo4j://localhost:7687' });

      expect(result.stderr).toContain('bolt://localhost:7687');
      expect(result.stderr).not.toContain('neo4j://localhost:7687');
    });

    it('converts neo4j+s:// to bolt+s:// for cypher-shell', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);
      writeMockCypherShell(mockDir, 'echo "$@" >&2\nexit 1');

      const result = runDomain({ NEO4J_URI: 'neo4j+s://secure.example.com:7687' });

      expect(result.stderr).toContain('bolt+s://secure.example.com:7687');
      expect(result.stderr).not.toContain('neo4j+s://secure.example.com:7687');
    });
  });

  // ── Error propagation ───────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('exits 1 and logs error when node push fails (cypher-shell exits 1)', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);
      // Always fail
      writeMockCypherShell(mockDir, 'echo "Connection failed" >&2\nexit 1');

      const result = runDomain();

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/node push failed/i);
    });

    it('exits 1 with friendly message when cypher-shell is not installed', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);

      const result = runScript(PUSH_DOMAIN, [root], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        // PATH without cypher-shell
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/install|brew|apt|neo4j\.com/i);
    });
  });

  // ── IMPLEMENTED_BY edges ────────────────────────────────────────────────────

  describe('IMPLEMENTED_BY edges target :Codebase nodes', () => {
    it('generates MATCH (b:Codebase ...) for IMPLEMENTED_BY edges', () => {
      writeDomainGraph(root, [SAMPLE_FEATURE_NODE], [SAMPLE_IMPLEMENTED_BY_EDGE]);
      // Capture stdin sent to cypher-shell (the Cypher queries)
      const logFile = join(root, 'queries.log');
      writeMockCypherShell(mockDir, `cat >> "${logFile}"\nexit 0`);

      runDomain();

      const queries = readFileSync(logFile, 'utf-8');
      // IMPLEMENTED_BY edge should target :Codebase, not :Knowledge
      expect(queries).toContain('Codebase');
      expect(queries).not.toMatch(/IMPLEMENTED_BY[^)]*:Knowledge/);
    });

    it('generates MATCH (b:Knowledge ...) for non-IMPLEMENTED_BY edges', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE, SAMPLE_FEATURE_NODE], [SAMPLE_DOMAIN_EDGE]);
      const logFile = join(root, 'queries.log');
      writeMockCypherShell(mockDir, `cat >> "${logFile}"\nexit 0`);

      runDomain();

      const queries = readFileSync(logFile, 'utf-8');
      // Non-IMPLEMENTED_BY edge targets :Knowledge
      expect(queries).toContain(':Knowledge');
    });
  });

  // ── Orphan check behavior ───────────────────────────────────────────────────

  describe('orphan check behavior', () => {
    it('logs ENOENT warning when cypher-shell not found (empty graph, PATH without cypher-shell)', () => {
      writeDomainGraph(root, [], []); // empty graph skips node/edge push

      const result = runScript(PUSH_DOMAIN, [root], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: '/usr/local/bin:/usr/bin:/bin', // no cypher-shell
      });

      // Empty graph: node/edge push skipped. Project update + orphan check
      // both call runCypherShell, which returns ENOENT warning.
      // The orphan check should log a WARNING, not silently swallow.
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/orphan check skipped|cypher-shell not found/i);
    });

    it('does not exit on orphan check failure (best-effort) — succeeds with nodes', () => {
      writeDomainGraph(root, [SAMPLE_DOMAIN_NODE], []);
      const countFile = join(root, 'count.txt');
      writeFileSync(countFile, '0');
      // Succeed on call 1 (node push) + call 2 (project update), fail on call 3 (orphan check)
      writeMockCypherShell(
        mockDir,
        [
          `count=$(cat "${countFile}" 2>/dev/null || echo 0)`,
          `count=$((count + 1))`,
          `echo $count > "${countFile}"`,
          `if [ "$count" -ge 3 ]; then`,
          `  echo "Orphan check error" >&2`,
          `  exit 1`,
          `fi`,
          `exit 0`,
        ].join('\n')
      );

      const result = runDomain();

      // Should still exit 0 even if orphan check fails (best-effort)
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/cypher-shell successfully/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// push-concept-graph.mjs — cypher-shell tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('push-concept-graph.mjs — NEO4J_CONNECTION_TYPE=cypher-shell', () => {
  let root;
  let mockDir;
  let origPath;

  beforeEach(() => {
    root = makeConceptRoot();
    mockDir = mkdtempSync(join(tmpdir(), 'concept-mock-cypher-'));
    origPath = process.env.PATH;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  function runInterview(extraEnv = {}) {
    return runScript(PUSH_CONCEPT, [root], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
      ...extraEnv,
    });
  }

  // ── Full push flow ──────────────────────────────────────────────────────────

  describe('full push flow', () => {
    it('exits 0 when cypher-shell succeeds for all stages', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE, SAMPLE_PAYMENT_NODE], [SAMPLE_INTERVIEW_EDGE]);
      writeMockCypherShell(mockDir, 'exit 0');

      const result = runInterview();

      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/cypher-shell successfully/i);
    });

    it('exits 0 with empty graph (no nodes, no edges)', () => {
      writeInterviewGraph(root, [], []);
      writeMockCypherShell(mockDir, 'exit 0');

      const result = runInterview();

      expect(result.status).toBe(0);
    });

    it('invokes cypher-shell with correct database flag', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE], []);
      const logFile = join(root, 'calls.log');
      writeMockCypherShell(mockDir, `echo "$@" >> "${logFile}"\nexit 0`);

      runInterview({ NEO4J_DATABASE: 'interviewdb' });

      const callLog = readFileSync(logFile, 'utf-8');
      expect(callLog).toContain('-d');
      expect(callLog).toContain('interviewdb');
    });
  });

  // ── URI conversion ──────────────────────────────────────────────────────────

  describe('URI conversion', () => {
    it('converts neo4j:// to bolt:// for cypher-shell', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE], []);
      writeMockCypherShell(mockDir, 'echo "$@" >&2\nexit 1');

      const result = runInterview({ NEO4J_URI: 'neo4j://localhost:7687' });

      expect(result.stderr).toContain('bolt://localhost:7687');
      expect(result.stderr).not.toContain('neo4j://localhost:7687');
    });

    it('converts neo4j+s:// to bolt+s:// for cypher-shell', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE], []);
      writeMockCypherShell(mockDir, 'echo "$@" >&2\nexit 1');

      const result = runInterview({ NEO4J_URI: 'neo4j+s://secure.example.com:7687' });

      expect(result.stderr).toContain('bolt+s://secure.example.com:7687');
      expect(result.stderr).not.toContain('neo4j+s://secure.example.com:7687');
    });
  });

  // ── Error propagation ───────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('exits 1 and logs error when node push fails (cypher-shell exits 1)', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE], []);
      writeMockCypherShell(mockDir, 'echo "Connection failed" >&2\nexit 1');

      const result = runInterview();

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/node push failed/i);
    });

    it('exits 1 with friendly message when cypher-shell is not installed', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE], []);

      const result = runScript(PUSH_CONCEPT, [root], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/install|brew|apt|neo4j\.com/i);
    });
  });

  // ── IMPLEMENTED_BY edges (Gap 2 fix) ────────────────────────────────────────

  describe('IMPLEMENTED_BY edges target :Codebase nodes (Gap 2 fix)', () => {
    it('generates MATCH (b:Codebase ...) for IMPLEMENTED_BY edges in cypher-shell path', () => {
      writeInterviewGraph(
        root,
        [SAMPLE_INTERVIEW_NODE],
        [SAMPLE_INTERVIEW_IMPLEMENTED_BY_EDGE]
      );
      const logFile = join(root, 'queries.log');
      writeMockCypherShell(mockDir, `cat >> "${logFile}"\nexit 0`);

      runInterview();

      const queries = readFileSync(logFile, 'utf-8');
      // IMPLEMENTED_BY edge should target :Codebase, not :Knowledge
      expect(queries).toContain('Codebase');
      expect(queries).not.toMatch(/IMPLEMENTED_BY[^)]*:Knowledge/);
    });

    it('generates MATCH (b:Knowledge ...) for non-IMPLEMENTED_BY edges', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE, SAMPLE_PAYMENT_NODE], [SAMPLE_INTERVIEW_EDGE]);
      const logFile = join(root, 'queries.log');
      writeMockCypherShell(mockDir, `cat >> "${logFile}"\nexit 0`);

      runInterview();

      const queries = readFileSync(logFile, 'utf-8');
      // Non-IMPLEMENTED_BY edge should target :Knowledge
      expect(queries).toContain(':Knowledge');
    });

    it('handles mixed IMPLEMENTED_BY and Knowledge edges correctly', () => {
      const knowledgeEdge = {
        source: 'feature:checkout',
        target: 'feature:payment',
        type: 'depends_on',
        weight: 1.0,
      };
      const implEdge = {
        source: 'feature:checkout',
        target: 'file:src/checkout.ts',
        type: 'IMPLEMENTED_BY',
        weight: 1.0,
      };
      writeInterviewGraph(
        root,
        [SAMPLE_INTERVIEW_NODE, SAMPLE_PAYMENT_NODE],
        [knowledgeEdge, implEdge]
      );
      const logFile = join(root, 'queries.log');
      writeMockCypherShell(mockDir, `cat >> "${logFile}"\nexit 0`);

      const result = runInterview();

      expect(result.status).toBe(0);
      const queries = readFileSync(logFile, 'utf-8');
      // Should contain both Codebase (for IMPLEMENTED_BY) and Knowledge (for depends_on)
      expect(queries).toContain('Codebase');
      expect(queries).toContain('Knowledge');
    });
  });

  // ── Orphan check behavior ───────────────────────────────────────────────────

  describe('orphan check behavior', () => {
    it('logs ENOENT warning when cypher-shell not found (empty graph, PATH without cypher-shell)', () => {
      writeInterviewGraph(root, [], []); // empty graph skips node/edge push

      const result = runScript(PUSH_CONCEPT, [root], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: '/usr/local/bin:/usr/bin:/bin', // no cypher-shell
      });

      expect(result.status).toBe(0);
      // ENOENT on orphan check should log a warning, not vanish silently
      expect(result.stderr).toMatch(/orphan check skipped|cypher-shell not found/i);
    });

    it('does not exit on orphan check failure (best-effort) — succeeds with nodes', () => {
      writeInterviewGraph(root, [SAMPLE_INTERVIEW_NODE], []);
      const countFile = join(root, 'count.txt');
      writeFileSync(countFile, '0');
      // Succeed on call 1 (node push) + call 2 (layer update), fail on call 3 (orphan check)
      writeMockCypherShell(
        mockDir,
        [
          `count=$(cat "${countFile}" 2>/dev/null || echo 0)`,
          `count=$((count + 1))`,
          `echo $count > "${countFile}"`,
          `if [ "$count" -ge 3 ]; then`,
          `  echo "Orphan check error" >&2`,
          `  exit 1`,
          `fi`,
          `exit 0`,
        ].join('\n')
      );

      const result = runInterview();

      // Should still exit 0 even if orphan check fails (best-effort)
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/cypher-shell successfully/i);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Gap 1: Orphan check uses runCypherShell helper (ENOENT triggers warning, not silence)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Gap 1 fix: orphan check uses runCypherShell helper consistently', () => {
  let root;
  let origPath;

  beforeEach(() => {
    origPath = process.env.PATH;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  it('push-domain-graph.mjs: ENOENT on orphan check logs warning (not silent)', () => {
    root = makeDomainRoot();
    writeDomainGraph(root, [], []); // empty graph: skip node+edge push

    const result = runScript(PUSH_DOMAIN, [root], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: '/usr/local/bin:/usr/bin:/bin', // no cypher-shell
    });

    // ENOENT on project-update is best-effort (skipped silently), but
    // orphan check ENOENT should emit a warning to stderr
    expect(result.stderr).toMatch(/orphan check skipped|cypher-shell not found/i);
  });

  it('push-concept-graph.mjs: ENOENT on orphan check logs warning (not silent)', () => {
    root = makeInterviewRoot();
    writeInterviewGraph(root, [], []); // empty graph: skip node+edge push

    const result = runScript(PUSH_CONCEPT, [root], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: '/usr/local/bin:/usr/bin:/bin', // no cypher-shell
    });

    expect(result.stderr).toMatch(/orphan check skipped|cypher-shell not found/i);
  });
});
