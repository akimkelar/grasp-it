/**
 * Tests for cypher-shell path bugs in push-codebase-graph.mjs
 *
 * Bug A: buildNodesCypher used `n.key = value` syntax inside a map literal.
 *        Valid Cypher requires bare key names with `:` separator: `key: value`.
 * Bug B: Arrays were stored as JSON strings '["auth","api"]' instead of
 *        Cypher list literals ['auth', 'api'].
 * Bug D: URI conversion regex `neo4j\+?://` did not handle `neo4j+s://` —
 *        the `s` broke the match, leaving the URI unchanged.
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

const SCRIPT_PATH = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/push-codebase-graph.mjs');

function runPushCodebaseGraph(projectRoot, extraEnv = {}) {
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

describe('push-codebase-graph.mjs — cypher-shell path bugs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-codebase-graph-bug-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function writeGraph(nodes = [], edges = []) {
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'assembled-graph.json'),
      JSON.stringify({
        project: { gitCommitHash: 'abc123' },
        version: '1.0.0',
        nodes,
        edges,
      }),
    );
  }

  // ── Bug A+B: buildNodesCypher generates valid Cypher map syntax ──────────────
  //
  // The SET n += {n.id = 'x', n.name = 'y'} syntax is invalid Cypher.
  // The correct form is SET n += {id: 'x', name: 'y'}.
  // Arrays must be emitted as Cypher list literals, not JSON strings.

  describe('BUG-A/B: buildNodesCypher generates valid Cypher map literal syntax', () => {
    it('map literal keys do not have n. prefix (cypher-shell path)', () => {
      writeGraph([
        { id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry point', tags: [] },
      ]);

      // NEO4J_TEST_MOCK=1 makes the driver fail fast so the cypher-shell fallback is entered.
      // PATH without cypher-shell means the fallback fails with our friendly ENOENT message.
      // We can inspect stderr to ensure no invalid n.key = syntax was used.
      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // The script should fail, but the error should NOT contain 'n.id =' or 'n.name ='
      // Those would indicate invalid map syntax like SET n += {n.id = '...'}
      expect(result.stderr).not.toMatch(/n\.(id|name|summary|kind|type|tags)\s*=/);
      // Should fail on connection or cypher-shell, not syntax
      expect(result.stderr).toMatch(/neo4j-driver not available|cypher-shell|Connection refused|ECONNREFUSED|failed|install/i);
    });

    it('map literal keys use correct key:value syntax (not n.key = value)', () => {
      writeGraph([
        { id: 'file:src/auth.ts', name: 'auth.ts', type: 'file', summary: 'Auth module', tags: ['auth', 'api'] },
      ]);

      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Invalid syntax would show n.id = or n.name = in error output
      expect(result.stderr).not.toMatch(/\bn\.id\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.name\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.summary\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.type\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.tags\s*=/);
      // Should fail on connection, not syntax
      expect(result.stderr).toMatch(/neo4j|Connection refused|ECONNREFUSED|failed|install/i);
    });

    it('arrays are emitted as Cypher list literals, not JSON strings (Bug B)', () => {
      writeGraph([
        { id: 'file:src/api.ts', name: 'api.ts', type: 'file', summary: 'API', tags: ['auth', 'api', 'v2'] },
      ]);

      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // JSON-stringified arrays would appear as '["auth","api"]' in the query
      // Cypher list literals appear as ['auth', 'api']
      expect(result.stderr).not.toMatch(/tags: '\["/);
      // Should fail on connection or cypher-shell
      expect(result.stderr).toMatch(/neo4j|Connection refused|ECONNREFUSED|failed|install/i);
    });
  });

  // ── Bug D: URI conversion handles neo4j+s:// ─────────────────────────────────

  describe('BUG-D: URI conversion for neo4j+s:// and neo4j://', () => {
    it('neo4j:// is converted to bolt:// for cypher-shell', () => {
      writeGraph([
        { id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] },
      ]);

      // Use a mock cypher-shell that echoes its args to stderr so we can verify
      // the URI was converted correctly. Use NEO4J_CONNECTION_TYPE=cypher-shell to
      // skip the driver and go directly to the cypher-shell path.
      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      // The mock cypher-shell echoed its args — check URI was converted
      expect(result.stderr).toContain('bolt://localhost:7687');
      expect(result.stderr).not.toContain('neo4j://localhost:7687');
    });

    it('neo4j+s:// is converted to bolt+s:// for cypher-shell (encrypted)', () => {
      writeGraph([
        { id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] },
      ]);

      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'neo4j+s://myhost.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      // neo4j+s:// must be converted to bolt+s://, not left as neo4j+s://
      expect(result.stderr).toContain('bolt+s://myhost.example.com:7687');
      expect(result.stderr).not.toContain('neo4j+s://myhost.example.com:7687');
    });

    it('bolt:// URI is passed through unchanged', () => {
      writeGraph([
        { id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] },
      ]);

      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushCodebaseGraph(root, {
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

    it('bolt+s:// URI is passed through unchanged', () => {
      writeGraph([
        { id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] },
      ]);

      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });

      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'bolt+s://myhost.example.com:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      expect(result.stderr).toContain('bolt+s://myhost.example.com:7687');
    });
  });

  // ── Bug E: ENOENT produces friendly install instructions ──────────────────────

  describe('BUG-E: friendly ENOENT error when cypher-shell is not installed', () => {
    it('returns install instructions when cypher-shell is not found (PATH excludes it)', () => {
      writeGraph([
        { id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] },
      ]);

      // NEO4J_TEST_MOCK=1 makes the driver fail fast, then cypher-shell is tried
      // but not found — ENOENT triggers the friendly install instructions message.
      const result = runPushCodebaseGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        // PATH that definitely has no cypher-shell
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      expect(result.status).toBe(1);
      // The error should mention installation — not just a raw ENOENT
      expect(result.stderr).toMatch(/install|brew|apt|neo4j\.com/i);
    });
  });
});
