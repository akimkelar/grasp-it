/**
 * Tests for cypher-shell path bugs in push-interview-graph.mjs
 *
 * Bug A: buildNodesCypher used `n.key = value` syntax inside a map literal.
 *        Valid Cypher requires bare key names with `:` separator: `key: value`.
 *        (push-interview-graph already used `:` but this test documents it)
 * Bug B: Arrays were stored as JSON strings '["auth","api"]' instead of
 *        Cypher list literals ['auth', 'api'].
 * Bug D: URI conversion regex `neo4j\+?://` did not handle `neo4j+s://`.
 * Bug E: ENOENT when cypher-shell is not installed produced a cryptic error.
 *        Now produces a friendly message with install instructions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPT_PATH = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-interview/push-interview-graph.mjs');

function runPushInterviewGraph(projectRoot, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return spawnSync('node', [SCRIPT_PATH, projectRoot], {
    encoding: 'utf-8',
    env,
    timeout: 30_000,
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('push-interview-graph.mjs — cypher-shell path bugs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-interview-graph-bug-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function writeGraph(nodes = [], edges = []) {
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'),
      JSON.stringify({ nodes }),
    );
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'pr-edges.json'),
      JSON.stringify({ edges }),
    );
  }

  // ── Bug A+B: buildNodesCypher generates valid Cypher map syntax ──────────────

  describe('BUG-A/B: buildNodesCypher generates valid Cypher map literal syntax', () => {
    it('map literal keys do not have n. prefix (cypher-shell path)', () => {
      writeGraph([
        { id: 'feature:auth', name: 'Auth Feature', summary: 'Auth feature', type: 'feature', tags: [] },
      ]);

      // NEO4J_TEST_MOCK=1 makes the driver fail fast so the cypher-shell fallback is entered.
      // PATH without cypher-shell means the fallback fails with our friendly ENOENT message.
      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      expect(result.stderr).not.toMatch(/n\.(id|name|summary|kind|type|tags)\s*=/);
      expect(result.stderr).toMatch(/neo4j-driver not available|cypher-shell|Connection refused|ECONNREFUSED|failed|install/i);
    });

    it('map literal uses id:value syntax, not n.id = value', () => {
      writeGraph([
        { id: 'feature:auth', name: 'Auth Feature', summary: 'Auth', type: 'feature', tags: ['auth'] },
      ]);

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      expect(result.stderr).not.toMatch(/\bn\.id\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.name\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.summary\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.tags\s*=/);
      expect(result.stderr).toMatch(/neo4j|Connection refused|ECONNREFUSED|failed|install/i);
    });

    it('array tags are emitted as Cypher list literals, not JSON strings (Bug B)', () => {
      writeGraph([
        { id: 'feature:auth', name: 'Auth Feature', summary: 'Auth', type: 'feature', tags: ['auth', 'api', 'v2'] },
      ]);

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // JSON-stringified arrays would appear as '["auth","api"]' in the query
      expect(result.stderr).not.toMatch(/tags: '\["/);
      expect(result.stderr).toMatch(/neo4j|Connection refused|ECONNREFUSED|failed|install/i);
    });

    it('scope and permissions arrays are emitted as Cypher list literals, not JSON strings', () => {
      writeGraph([
        {
          id: 'risk:test-risk',
          name: 'Test Risk',
          summary: 'A risk',
          type: 'risk',
          tags: ['security'],
          scope: ['feature:auth', 'feature:billing'],
          permissions: ['read', 'write'],
          restrictions: ['delete'],
        },
      ]);

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // JSON-stringified arrays would appear as '["feature:auth"...]' in the query
      expect(result.stderr).not.toMatch(/scope: '\["/);
      expect(result.stderr).not.toMatch(/permissions: '\["/);
      expect(result.stderr).not.toMatch(/restrictions: '\["/);
      expect(result.stderr).toMatch(/neo4j|Connection refused|ECONNREFUSED|failed|install/i);
    });
  });

  // ── Bug D: URI conversion handles neo4j+s:// ─────────────────────────────────

  describe('BUG-D: URI conversion for neo4j+s:// and neo4j://', () => {
    it('neo4j:// is converted to bolt:// for cypher-shell', () => {
      writeGraph([
        { id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature', tags: [] },
      ]);

      // Use NEO4J_CONNECTION_TYPE=cypher-shell to skip the driver path entirely
      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      expect(result.stderr).toContain('bolt://localhost:7687');
      expect(result.stderr).not.toContain('neo4j://localhost:7687');
    });

    it('neo4j+s:// is converted to bolt+s:// for cypher-shell (encrypted)', () => {
      writeGraph([
        { id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature', tags: [] },
      ]);

      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j+s://myhost.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      expect(result.stderr).toContain('bolt+s://myhost.example.com:7687');
      expect(result.stderr).not.toContain('neo4j+s://myhost.example.com:7687');
    });

    it('bolt:// URI is passed through unchanged', () => {
      writeGraph([
        { id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature', tags: [] },
      ]);

      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      expect(result.stderr).toContain('bolt://localhost:7687');
    });
  });

  // ── Bug E: ENOENT produces friendly install instructions ──────────────────────

  describe('BUG-E: friendly ENOENT error when cypher-shell is not installed', () => {
    it('returns install instructions when cypher-shell is not found', () => {
      writeGraph([
        { id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature', tags: [] },
      ]);

      // NEO4J_TEST_MOCK=1 makes driver fail fast, then the fallback tries cypher-shell
      // which is not in PATH, triggering the ENOENT friendly error message.
      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      expect(result.status).toBe(1);
      // Should mention installation — not just raw ENOENT
      expect(result.stderr).toMatch(/install|brew|apt|neo4j\.com/i);
    });
  });
});
