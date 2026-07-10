/**
 * Tests for cypher-shell path bugs across multiple scripts.
 *
 * Bug C: load-project-meta.mjs used "neo4j" as the default database in the
 *        cypher-shell path instead of "grasp".
 * Bug D: URI conversion regex `neo4j\+?://` did not handle `neo4j+s://` —
 *        the `s` broke the match, leaving the URI unchanged.
 *        Fix: chain `.replace(/^neo4j\+s:\/\//, "bolt+s://")` before
 *        `.replace(/^neo4j:\/\//, "bolt://")`.
 *
 * These tests cover load-project-meta.mjs and run-query.mjs.
 * See test_push_codebase_graph_cypher_bugs.test.mjs for push-codebase-graph.mjs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOAD_PROJECT_META = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/load-project-meta.mjs');
const RUN_QUERY = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs');

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

// ── Bug C: load-project-meta.mjs uses "grasp" as default database ────────────

describe('BUG-C: load-project-meta.mjs cypher-shell path uses "grasp" as default database', () => {
  let root;
  let mockDir;
  let origPath;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lpm-bugc-'));
    mockDir = mkdtempSync(join(tmpdir(), 'lpm-bugc-mock-'));
    origPath = process.env.PATH;
    // Write a mock cypher-shell that echoes its args to stderr so we can verify
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\necho '[{"keys":["gitCommitHash"],"fields":[]}]'\n`, { mode: 0o755 });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  it('passes -d grasp to cypher-shell when NEO4J_DATABASE is not set', () => {
    const result = runScript(LOAD_PROJECT_META, [root], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      NEO4J_DATABASE: undefined, // not set — should default to "grasp"
      PATH: `${mockDir}:${origPath}`,
    });

    // Mock echoed args to stderr — check -d flag value
    expect(result.stderr).toContain('-d');
    expect(result.stderr).toContain('grasp');
    expect(result.stderr).not.toMatch(/-d neo4j\b/);
  });

  it('passes -d with correct value from NEO4J_DATABASE env var', () => {
    const result = runScript(LOAD_PROJECT_META, [root], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      NEO4J_DATABASE: 'mydb',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.stderr).toContain('mydb');
    expect(result.stderr).not.toMatch(/-d neo4j\b/);
  });
});

// ── Bug D: URI conversion handles neo4j+s:// ─────────────────────────────────

describe('BUG-D: URI conversion for neo4j+s:// and neo4j://', () => {
  let root;
  let mockDir;
  let origPath;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uri-bugd-'));
    mockDir = mkdtempSync(join(tmpdir(), 'uri-bugd-mock-'));
    origPath = process.env.PATH;
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  describe('load-project-meta.mjs URI conversion', () => {
    it('converts neo4j:// to bolt:// for cypher-shell', () => {
      const result = runScript(LOAD_PROJECT_META, [root], {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt://localhost:7687');
      expect(result.stderr).not.toContain('neo4j://localhost:7687');
    });

    it('converts neo4j+s:// to bolt+s:// for cypher-shell (encrypted)', () => {
      const result = runScript(LOAD_PROJECT_META, [root], {
        NEO4J_URI: 'neo4j+s://secure.host.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt+s://secure.host.example.com:7687');
      expect(result.stderr).not.toContain('neo4j+s://secure.host.example.com:7687');
    });

    it('passes bolt:// through unchanged', () => {
      const result = runScript(LOAD_PROJECT_META, [root], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt://localhost:7687');
    });

    it('passes bolt+s:// through unchanged', () => {
      const result = runScript(LOAD_PROJECT_META, [root], {
        NEO4J_URI: 'bolt+s://secure.host.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt+s://secure.host.example.com:7687');
    });
  });

  describe('run-query.mjs URI conversion', () => {
    it('converts neo4j:// to bolt:// for cypher-shell', () => {
      const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n LIMIT 1'], {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt://localhost:7687');
      expect(result.stderr).not.toContain('neo4j://localhost:7687');
    });

    it('converts neo4j+s:// to bolt+s:// for cypher-shell (encrypted)', () => {
      const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n LIMIT 1'], {
        NEO4J_URI: 'neo4j+s://secure.host.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt+s://secure.host.example.com:7687');
      expect(result.stderr).not.toContain('neo4j+s://secure.host.example.com:7687');
    });

    it('passes bolt:// through unchanged', () => {
      const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n LIMIT 1'], {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt://localhost:7687');
    });

    it('passes bolt+s:// through unchanged', () => {
      const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n LIMIT 1'], {
        NEO4J_URI: 'bolt+s://secure.host.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:${origPath}`,
      });

      expect(result.stderr).toContain('bolt+s://secure.host.example.com:7687');
    });
  });
});

// ── Pure unit tests: URI conversion logic ────────────────────────────────────
//
// These test the JS regex replacement logic directly (no subprocess needed).

describe('URI conversion logic (unit tests)', () => {
  function convertUri(uri) {
    return uri
      .replace(/^neo4j\+s:\/\//, 'bolt+s://')
      .replace(/^neo4j:\/\//, 'bolt://');
  }

  it('neo4j:// → bolt://', () => {
    expect(convertUri('neo4j://localhost:7687')).toBe('bolt://localhost:7687');
  });

  it('neo4j+s:// → bolt+s://', () => {
    expect(convertUri('neo4j+s://localhost:7687')).toBe('bolt+s://localhost:7687');
  });

  it('bolt:// → bolt:// (unchanged)', () => {
    expect(convertUri('bolt://localhost:7687')).toBe('bolt://localhost:7687');
  });

  it('bolt+s:// → bolt+s:// (unchanged)', () => {
    expect(convertUri('bolt+s://localhost:7687')).toBe('bolt+s://localhost:7687');
  });

  it('neo4j+s:// with complex host is converted correctly', () => {
    expect(convertUri('neo4j+s://db.example.com:7687/path')).toBe('bolt+s://db.example.com:7687/path');
  });

  it('old regex neo4j\\+? only matched neo4j+ prefix, not neo4j+s', () => {
    // This test documents the OLD (broken) behavior for comparison.
    // The old regex: /^neo4j\+?:\/\//
    // neo4j+s:// — the `s` prevents the match — URI passes through unchanged (wrong!)
    const oldConvert = (uri) => uri.replace(/^neo4j\+?:\/\//, 'bolt://');
    expect(oldConvert('neo4j+s://host:7687')).toBe('neo4j+s://host:7687'); // BUG: unchanged
    expect(oldConvert('neo4j://host:7687')).toBe('bolt://host:7687'); // correct
  });
});

// ── Bug 01: run-query.mjs hardcoded --format json which cypher-shell 2026.x removed ───
//
// cypher-shell version 2026.x removed the `json` output format (only
// {auto, verbose, plain} remain). run-query.mjs line 139 hardcoded
// "--format json" and called JSON.parse() on the output, which broke all
// cypher-shell invocations on modern cypher-shell.
//
// Fix: run-query.mjs always uses --format plain and parses the plain-text
// output. The plain output from cypher-shell looks like:
//
//   key1, key2, key3
//   val1, val2, val3
//   val1, val2, val3
//
// The first line is the comma-joined keys (from the first record). Each
// subsequent line is the comma-joined values for that record. There is no
// "rows available" trailer in plain format.

describe('BUG-01: run-query.mjs uses --format plain and parses plain-text output', () => {
  let root;
  let mockDir;
  let origPath;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bug01-'));
    mockDir = mkdtempSync(join(tmpdir(), 'bug01-mock-'));
    origPath = process.env.PATH;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  // Mock cypher-shell that writes plain-text output to stdout. Captures argv
  // to stderr so the test can verify the --format flag is "plain" (not "json").
  function installMockPlainCypher(plainOutput) {
    const script = `#!/bin/sh
echo "$@" >&2
cat <<'PLAIN_EOF'
${plainOutput}
PLAIN_EOF
`;
    writeFileSync(join(mockDir, 'cypher-shell'), script, { mode: 0o755 });
  }

  it('passes --format plain (NOT --format json) to cypher-shell', () => {
    installMockPlainCypher('n\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n LIMIT 1'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    // Plain output (one value "n" → one record) should be parsed successfully.
    expect(result.status).toBe(0);
    // The args we passed to cypher-shell (joined with spaces in stderr) must
    // contain --format plain.
    const argvString = result.stderr;
    expect(argvString).toMatch(/--format\s+plain\b/);
    // Crucially: must NOT contain --format json.
    expect(argvString).not.toMatch(/--format\s+json\b/);
  });

  it('parses plain output: single record, multiple columns', () => {
    installMockPlainCypher('name,kind\nUserService,service\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n.name AS name, labels(n)[0] AS kind'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([{ name: 'UserService', kind: 'service' }]);
  });

  it('parses plain output: multiple records', () => {
    installMockPlainCypher('id,score\nnode:1,42\nnode:2,87\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n.id AS id, n.score AS score'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([
      { id: 'node:1', score: '42' },
      { id: 'node:2', score: '87' },
    ]);
  });

  it('parses plain output: null values', () => {
    installMockPlainCypher('name,description\nUserService,\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n.name AS name, n.description AS description'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([{ name: 'UserService', description: null }]);
  });

  it('parses plain output: empty results (header only, no data rows)', () => {
    installMockPlainCypher('name\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n.name AS name LIMIT 0'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([]);
  });

  it('parses plain output: tolerates trailing carriage returns (CRLF line endings)', () => {
    installMockPlainCypher('name\r\nUserService\r\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n.name AS name'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toEqual([{ name: 'UserService' }]);
  });

  it('parses plain output: number-like values come through as strings (cypher-shell toString semantics)', () => {
    installMockPlainCypher('n\n42\n87\n');
    const result = runScript(RUN_QUERY, [root, 'MATCH (n) RETURN n.value AS n'], {
      NEO4J_URI: 'bolt://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:${origPath}`,
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // cypher-shell plain format uses .toString() on values, so integers
    // arrive as strings. Callers should coerce if they need numbers.
    expect(parsed.results).toEqual([{ n: '42' }, { n: '87' }]);
  });
});
