/**
 * Tests for cypher-shell path bugs in push-concept-graph.mjs
 *
 * Bug A: buildNodesCypher used `n.key = value` syntax inside a map literal.
 *        Valid Cypher requires bare key names with `:` separator: `key: value`.
 *        (push-concept-graph already used `:` but this test documents it)
 * Bug B: Arrays were stored as JSON strings '["auth","api"]' instead of
 *        Cypher list literals ['auth', 'api'].
 * Bug D: URI conversion regex `neo4j\+?://` did not handle `neo4j+s://`.
 * Bug E: ENOENT when cypher-shell is not installed produced a cryptic error.
 *        Now produces a friendly message with install instructions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPT_PATH = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-concept/push-concept-graph.mjs');

function runPushConceptGraph(projectRoot, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  // Strip cypher-shell from PATH so the cypher-shell fallback in push-concept-graph.mjs
  // fails fast (ENOENT) instead of hanging on an unreachable port. This makes the tests
  // independent of whether cypher-shell is installed in the test environment.
  if (env.PATH && !extraEnv.PATH) {
    env.PATH = env.PATH
      .split(':')
      .filter(p => !existsSync(join(p, 'cypher-shell')))
      .join(':');
  }
  return spawnSync('node', [SCRIPT_PATH, projectRoot], {
    encoding: 'utf-8',
    env,
    timeout: 25_000,
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('push-concept-graph.mjs — cypher-shell path bugs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-concept-graph-bug-'));
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
      const result = runPushConceptGraph(root, {
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

      const result = runPushConceptGraph(root, {
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

      const result = runPushConceptGraph(root, {
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

      const result = runPushConceptGraph(root, {
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

      const result = runPushConceptGraph(root, {
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

      const result = runPushConceptGraph(root, {
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

      const result = runPushConceptGraph(root, {
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
      const result = runPushConceptGraph(root, {
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

  // ── Fix 1: domain type is now in TYPE_TO_LABEL ───────────────────────────────

  describe('FIX-1: domain node type is accepted (not rejected)', () => {
    it('domain node type does not trigger unknown-type warning', () => {
      writeGraph([
        { id: 'domain:billing', name: 'Billing', summary: 'The billing domain', type: 'domain' },
      ]);

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Must NOT be rejected as an unknown type
      expect(result.stderr).not.toContain("Unknown node type 'domain'");
      // Script reaches the connection phase — not a pre-flight validation failure
      expect(result.stderr).toMatch(/neo4j-driver not available|cypher-shell|Connection refused|ECONNREFUSED|failed|install/i);
    });

    it('domain node is included in the generated Cypher (cypher-shell path)', () => {
      writeGraph([
        { id: 'domain:billing', name: 'Billing', summary: 'The billing domain', type: 'domain' },
      ]);

      // Mock that echoes stdin (the Cypher query) to stderr so we can inspect it,
      // then exits 0 to let the script proceed through all phases.
      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\ncat >&2\nexit 0\n`, { mode: 0o755 });

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      // The mock echoes stdin (the Cypher query); it should reference the Domain label
      expect(result.stderr).toContain('Domain');
      expect(result.stderr).toContain('domain:billing');
    });
  });

  // ── Fix 2: unknown node type aborts the push atomically (no partial writes) ────

  describe('FIX-2: unknown node type aborts the push atomically', () => {
    it('rejects the entire batch when any node has unknown type', () => {
      writeGraph([
        { id: 'foobar:bad', name: 'Bad', summary: 'Unknown type', type: 'foobar' },
        { id: 'feature:good', name: 'Good', summary: 'Valid type', type: 'feature' },
      ]);

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // The bad node's specific error is emitted
      expect(result.stderr).toContain("Unknown node type 'foobar'");
      // The summary confirms atomic rejection — push aborted before Neo4j
      expect(result.stderr).toMatch(/push aborted/i);
      // Script does NOT reach the driver/cypher-shell phase
      expect(result.stderr).not.toMatch(/neo4j-driver not available|cypher-shell|failed|install/i);
      // Non-zero exit (BUG-02)
      expect(result.status).not.toBe(0);
    });

    it('all-unknown batch: still exits with specific error, no spurious "file not found" message', () => {
      writeGraph([
        { id: 'notype:a', name: 'A', summary: 'Bad', type: 'notype' },
      ]);

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_TEST_MOCK: '1',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Specific error for the unknown type
      expect(result.stderr).toContain("Unknown node type 'notype'");
      // No spurious pre-flight errors — the script reached validation phase
      expect(result.stderr).not.toContain('Nodes file not found');
      expect(result.stderr).not.toContain('Edges file not found');
      // Atomic rejection — push aborted
      expect(result.stderr).toMatch(/push aborted/i);
      expect(result.status).not.toBe(0);
    });
  });

  // ── Fix 3: edge type with spaces produces valid UPPER_SNAKE_CASE ─────────────

  describe('FIX-3: edge type with spaces is normalised to UPPER_SNAKE_CASE', () => {
    it('space in edge type is replaced with underscore in generated Cypher (cypher-shell path)', () => {
      writeGraph(
        [
          { id: 'feature:a', name: 'A', summary: 'Feature A', type: 'feature' },
          { id: 'feature:b', name: 'B', summary: 'Feature B', type: 'feature' },
        ],
        [
          { source: 'feature:a', target: 'feature:b', type: 'has feature', weight: 1.0 },
        ],
      );

      // Mock echoes stdin (the Cypher query) to stderr and exits 0 so all phases run.
      // Nodes are pushed first (succeeds), then edges — the edge Cypher with the
      // normalised relationship type will appear in stderr.
      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\ncat >&2\nexit 0\n`, { mode: 0o755 });

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      // The relationship type with space should be normalised: "has feature" → "HAS_FEATURE"
      expect(result.stderr).toContain('HAS_FEATURE');
      // Raw space should NOT appear as part of a relationship type in the Cypher output
      expect(result.stderr).not.toMatch(/:`HAS FEATURE`/);
    });

    it('hyphen and space in edge type both become underscores', () => {
      writeGraph(
        [
          { id: 'feature:a', name: 'A', summary: 'A', type: 'feature' },
          { id: 'feature:b', name: 'B', summary: 'B', type: 'feature' },
        ],
        [
          { source: 'feature:a', target: 'feature:b', type: 'is-part of', weight: 1.0 },
        ],
      );

      // Mock echoes stdin (Cypher query) to stderr and exits 0.
      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh\ncat >&2\nexit 0\n`, { mode: 0o755 });

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      // "is-part of" → "IS_PART_OF"
      expect(result.stderr).toContain('IS_PART_OF');
    });
  });

  // ── Fix 4: orphan check WHERE clause includes n:Domain ───────────────────────

  describe('FIX-4: orphan check WHERE clause includes n:Domain', () => {
    it('cypher-shell orphan query contains n:Domain in the NOT clause', () => {
      writeGraph([
        { id: 'domain:billing', name: 'Billing', summary: 'Billing domain', type: 'domain' },
      ]);

      // Use a mock cypher-shell that echoes stdin so we can inspect the query
      const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-'));
      // Echo stdin to stderr so spawnSync captures it; first invocation (nodes) exits 0,
      // subsequent ones (edges, layer, orphan-check) also exit 0.
      writeFileSync(
        join(mockDir, 'cypher-shell'),
        `#!/bin/sh\ncat >&2\necho "---" >&2\n`,
        { mode: 0o755 },
      );

      const result = runPushConceptGraph(root, {
        NEO4J_URI: 'neo4j://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'grasp',
        NEO4J_CONNECTION_TYPE: 'cypher-shell',
        PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
      });

      rmSync(mockDir, { recursive: true, force: true });

      // The orphan-check query should include n:Domain so Domain nodes are not
      // incorrectly flagged as orphans
      expect(result.stderr).toMatch(/n:Domain/);
    });
  });
});
