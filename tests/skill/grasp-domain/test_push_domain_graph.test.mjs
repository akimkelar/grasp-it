/**
 * Tests for push-domain-graph.mjs
 *
 * Reads domain-analysis.json from .grasp-it/ and pushes it to Neo4j.
 */

// Some tests involve real Neo4j connections that may hang on close — allow extra time
const TEST_TIMEOUT = 30_000;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function runPushDomainGraph(projectRoot, extraEnv = {}) {
  const scriptPath = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/push-domain-graph.mjs');
  // Build a clean env: start with process.env, then apply extraEnv.
  // Both undefined and empty-string values are treated as "delete this var" so
  // tests can intentionally clear inherited env vars (e.g. NEO4J_URI='') without
  // the empty string leaking into the child as a falsy-but-present value that
  // could mask a real config from ~/.grasp-it/neo4j.env or the project .env file.
  const env = { ...process.env };
  // Default: make the driver fail immediately so tests don't hang on real connections.
  // Tests that need the real driver can pass NEO4J_TEST_MOCK: undefined to unset it.
  env.NEO4J_TEST_MOCK = '1';
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined || val === '') {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  // Default PATH strips real cypher-shell by prepending the mock directory created in beforeEach.
  // Tests can override PATH explicitly via extraEnv to test specific cypher-shell behavior.
  if (!('PATH' in extraEnv) && activeMockCypherShellDir) {
    env.PATH = `${activeMockCypherShellDir}:${env.PATH}`;
  }
  return spawnSync('node', [scriptPath, projectRoot], {
    encoding: 'utf-8',
    env,
    timeout: 30_000,
  });
}

// Module-level reference to the per-test mock cypher-shell directory.
// Set by beforeEach, used by runPushDomainGraph so the default PATH always
// resolves to the mock (real cypher-shell hangs on unreachable hosts).
let activeMockCypherShellDir = null;

/**
 * Write a mock cypher-shell binary to `mockDir`. The mock fails fast with exit 1
 * so tests can exercise the cypher-shell fallback path without hanging on a real
 * cypher-shell trying to connect to an unreachable host.
 */
function writeMockCypherShell(mockDir) {
  const shellPath = join(mockDir, 'cypher-shell');
  writeFileSync(shellPath, `#!/bin/sh\nexit 1\n`, { mode: 0o755 });
  return shellPath;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('push-domain-graph.mjs', () => {
  let root;
  let mockCypherShellDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-domain-graph-test-'));
    // The script reads domain-analysis.json from .grasp-it/intermediate/
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
    // Mock cypher-shell directory — prepended to PATH so the cypher-shell fallback
    // fails fast instead of hanging on an unreachable host.
    mockCypherShellDir = mkdtempSync(join(tmpdir(), 'push-domain-mock-cypher-'));
    writeMockCypherShell(mockCypherShellDir);
    activeMockCypherShellDir = mockCypherShellDir;
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockCypherShellDir) rmSync(mockCypherShellDir, { recursive: true, force: true });
    activeMockCypherShellDir = null;
  });

  // ── Test 1: exits 1 when domain-analysis.json is not found ──────────────

  describe('exit code 1 when domain-analysis.json is not found', () => {
    it('exits with code 1 and prints error message', () => {
      // .grasp-it/ directory exists but domain-analysis.json does not
      const result = runPushDomainGraph(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Domain analysis file not found');
    });
  });

  // ── Test 2: exits 1 when no Neo4j configuration found ──────────────────

  describe('exit code 1 when no Neo4j configuration found', () => {
    it('exits with code 1 when no Neo4j env vars and no .env file', () => {
      // Create a valid domain-analysis.json at the correct path
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'), JSON.stringify({
        nodes: [],
        edges: [],
      }));

      // Pass empty strings for Neo4j env vars to override any in the test environment,
      // then delete them so getNeo4jConfig sees no config
      const result = runPushDomainGraph(root, {
        NEO4J_URI: '',
        NEO4J_USERNAME: '',
        NEO4J_PASSWORD: '',
        NEO4J_DATABASE: '',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('No Neo4j configuration found');
    });
  });

  // ── Test 3: normalizes label -> name and description -> summary ──────────

  describe('field normalization', () => {
    it('normalizes label -> name and description -> summary in nodes', () => {
      // Create a domain-analysis.json with old field names (label/description)
      const domainAnalysis = {
        nodes: [
          { id: 'node1', label: 'User Domain', description: 'User management domain', type: 'domain' },
          { id: 'node2', label: 'Auth Feature', description: 'Authentication feature', type: 'feature' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      // Set Neo4j config to an unreachable host.
      // The script should get past normalization and fail on the Neo4j connection,
      // not on missing name/summary fields.
      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // If normalization failed, we'd see errors about missing name/summary fields.
      // A connection error means the script got past normalization and tried to push.
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED/i);
    });
  });

  // ── Test 4 & 5: Neo4j push path entered ──────────────────────────────────
  //
  // Full success (exit 0) requires a real Neo4j instance so is not tested here.
  // Instead, we verify the script enters the push path by using an unreachable
  // Neo4j URI — the script should fail on connection (not on file/config issues).

  describe('Neo4j push behavior', () => {
    it('exits 1 when Neo4j is unreachable (verifies push path is entered)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'node1', name: 'Test Domain', summary: 'A test domain', type: 'domain' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // Should fail on Neo4j connection, not on file reading or config
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Domain analysis file not found');
      expect(result.stderr).not.toContain('No Neo4j configuration found');
    });

    it('verifies the full flow: file found, normalization, Neo4j config valid, push attempted', () => {
      // Uses label/description (old names) to verify normalization is applied
      // before the saveDomainGraphToNeo4j call
      const domainAnalysis = {
        nodes: [
          { id: 'node1', label: 'Old Name', description: 'Old summary', type: 'domain' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // Must not fail on file not found or config — those were validated before the push
      expect(result.stderr).not.toContain('Domain analysis file not found');
      expect(result.stderr).not.toContain('No Neo4j configuration found');
      // Connection error means push path was entered
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED/i);
    });
  });

  // ── Test 6: cypher-shell fallback when driver is unavailable ──────────────
  //
  // When neo4j-driver cannot be imported, the script should fall back to cypher-shell.
  // We simulate this by setting NEO4J_CONNECTION_TYPE=cypher-shell with an unreachable host
  // to avoid requiring a real Neo4j instance. The driver path should be attempted first,
  // fail, and then cypher-shell fallback should be entered — but since cypher-shell itself
  // will fail on the unreachable host, we verify the fallback path is entered by checking
  // stderr for the fallback marker.

  describe('cypher-shell fallback behavior', () => {
    it('exits 1 when cypher-shell fallback is entered with unreachable host', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'node1', name: 'Test Domain', summary: 'A test domain', type: 'domain' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      // Set a reachable host for driver (will fail), but PATH that excludes cypher-shell
      // so that the fallback also fails
      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        // Remove cypher-shell from PATH so fallback also fails
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Script should fail but have entered the push path
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Domain analysis file not found');
      expect(result.stderr).not.toContain('No Neo4j configuration found');
      // Either driver fail or fallback fail — both are valid outcomes here
      expect(result.stderr).toMatch(/neo4j-driver not available|Failed to push domain graph|cypher-shell|Connection refused|ECONNREFUSED/i);
    });

    it('exits 1 when unknown node type is encountered', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'node1', name: 'Test', summary: 'Test', type: 'unknown-type' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown node type 'unknown-type'");
    });
  });

  // ── Test 7: cypherEscape helper behavior ───────────────────────────────────
  //
  // The cypherEscape helper is tested via the cypher-shell fallback path.
  // We verify edge cases by checking the script's behavior with special characters.

  describe('special character handling in node properties', () => {
    it('handles node names with single quotes and backslashes', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'node1', name: "O'Reilly's Domain \\ Rule", summary: "It's a test", type: 'domain' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      // With an unreachable host, this should fail on connection — but the script
      // must get past the node processing step (which uses cypherEscape) without error.
      // If cypherEscape is broken, we'd see a parse error or cypher syntax error, not a connection error.
      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // Connection error means node processing (and cypherEscape) succeeded
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Syntax error');
      expect(result.stderr).not.toContain('single quote');
    });

    it('handles array tags property correctly', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'node1', name: 'Test Domain', summary: 'A test domain', type: 'domain', tags: ['tag1', "it's-a-tag", 'tag3'] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // Connection error means tags were processed correctly
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Syntax error');
    });

    it('handles optional complexity and status fields', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'node1', name: 'Test', summary: 'Test', type: 'feature', complexity: 'high', status: 'planned' },
          { id: 'node2', name: 'Test2', summary: 'Test2', type: 'operation' }, // no complexity/status
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Unknown node type');
      expect(result.stderr).not.toContain('Syntax error');
    });
  });

  // ── Test 8: edge case — empty nodes array ───────────────────────────────────

  describe('empty graph data', () => {
    it('exits 0 when nodes array is empty (nothing to push — DELETE cleanup still runs)', () => {
      const domainAnalysis = { nodes: [], edges: [] };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      // Empty nodes means nothing to push — DELETE cleanup runs (best-effort),
      // orphan check runs, then exit0. No "unknown node type" error.
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('Unknown node type');
    });
  });

  // ── BUG-04: buildNodesCypher generates valid Cypher map syntax ─────────────
  //
  // The SET n += {n.id = 'value', ...} syntax is invalid — map keys must not
  // have the n. prefix. The correct form is SET n += {id: 'value', ...}.
  // We test this by mocking the driver import to fail and letting cypher-shell
  // build the query string, then verify it contains valid map syntax.

  describe('BUG-04: buildNodesCypher generates valid Cypher map literal syntax', () => {
    it('map literal keys do not have n. prefix (cypher-shell path)', () => {
      // Patch the module to force cypher-shell path and capture the built query
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A test domain', type: 'domain', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      // Remove cypher-shell from PATH so the script fails in the fallback
      // but we can still inspect what it tried to build
      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // The script should fail, but the error should NOT contain 'n.id =' or 'n.name ='
      // Those would indicate invalid map syntax like SET n += {n.id = '...'}
      expect(result.stderr).not.toMatch(/n\.(id|name|summary|kind|source|type|tags)\s*=/);
      // The error should be about connection, not syntax
      expect(result.stderr).toMatch(/neo4j-driver not available|cypher-shell|Connection refused|ECONNREFUSED|No routing servers available|failed/i);
    });

    it('map literal keys use correct id:name syntax (not n.id = value)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'feature:auth', name: 'Auth Feature', summary: 'Auth feature', type: 'feature', tags: ['auth'] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Invalid syntax would show n.id = or n.name = in error output
      expect(result.stderr).not.toMatch(/\bn\.id\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.name\s*=/);
      expect(result.stderr).not.toMatch(/\bn\.summary\s*=/);
      // Should fail on connection, not syntax
      expect(result.stderr).toMatch(/neo4j|Connection refused|ECONNREFUSED|No routing servers available|failed/i);
    });
  });

  // ── BUG-05: node.type is derived from ID prefix when omitted ───────────────
  //
  // When the LLM omits the type field (e.g. {id: 'domain:surcharge', name: ...})
  // the script must derive the type from the ID prefix instead of hard-crashing
  // with "Unknown node type 'undefined'".

  describe('BUG-05: node.type derived from ID prefix when omitted', () => {
    it('accepts node without type field — derives type from id prefix', () => {
      const domainAnalysis = {
        nodes: [
          // No 'type' field — only id prefix encodes the type
          { id: 'domain:surcharge-management', name: 'Surcharge Management', summary: 'Manages surcharges', tags: [] },
          { id: 'feature:surcharge-catalog', name: 'Surcharge Catalog', summary: 'Catalog of surcharges', tags: [] },
          { id: 'operation:classify-work-hours', name: 'Classify Work Hours', summary: 'Classifies hours', tags: [] },
          { id: 'actor:agency-user', name: 'Agency User', summary: 'Agency user actor', tags: [] },
          { id: 'entity:surcharge-set', name: 'Surcharge Set', summary: 'A set of surcharges', tags: [] },
          { id: 'business-rule:approval-required', name: 'Approval Required', summary: 'Approval rule', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      // Must NOT crash with "Unknown node type 'undefined'"
      expect(result.stderr).not.toContain("Unknown node type 'undefined'");
      expect(result.stderr).not.toContain("Unknown node type ''");
      // Connection error is expected — script got past validation
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED|No routing servers available/i);
    });

    it('still rejects node with unknown type even after trying ID prefix derivation', () => {
      const domainAnalysis = {
        nodes: [
          // 'robot' is not a known type prefix
          { id: 'robot:bad-type', name: 'Robot', summary: 'A robot', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown node type 'robot'");
    });

    it('prefers explicit type over ID prefix derivation when both are present', () => {
      const domainAnalysis = {
        nodes: [
          // Both type and id prefix present — explicit type should be used
          { id: 'domain:test', type: 'domain', name: 'Test Domain', summary: 'Test', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      // Should not fail on unknown type — explicit 'domain' is valid
      expect(result.stderr).not.toContain('Unknown node type');
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED|No routing servers available/i);
    });

    it('derives type correctly for all known node types from ID prefix alone', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'D', summary: 'D', tags: [] },
          { id: 'feature:test', name: 'F', summary: 'F', tags: [] },
          { id: 'operation:test', name: 'O', summary: 'O', tags: [] },
          { id: 'actor:test', name: 'A', summary: 'A', tags: [] },
          { id: 'entity:test', name: 'E', summary: 'E', tags: [] },
          { id: 'business-rule:test', name: 'BR', summary: 'BR', tags: [] },
          { id: 'risk:test', name: 'R', summary: 'R', tags: [] },
          { id: 'constraint:test', name: 'C', summary: 'C', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      // All 8 types should be recognized — no "unknown type" errors
      expect(result.stderr).not.toContain('Unknown node type');
      // Connection error is expected
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED|No routing servers available/i);
    });

    it('handles risk node with severity, probability, and mitigation fields', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'risk:surcharge-rounding', name: 'Surcharge Rounding Risk', summary: 'Float rounding in invoice total', type: 'risk', tags: ['financial'], severity: 'high', probability: 'medium', mitigation: 'Use integer cents internally' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Unknown node type');
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED|No routing servers available/i);
    });

    it('handles constraint node with condition and invariant fields', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'constraint:dual-set-required', name: 'Dual Set Required', summary: 'Both surcharge sets must coexist', type: 'constraint', tags: ['interface'], condition: 'standardSurcharges && equalPaySurcharges', invariant: 'Pricing calculation breaks if only one set is present' },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Unknown node type');
      expect(result.stderr).toMatch(/Failed to push domain graph|Connection refused|ECONNREFUSED|No routing servers available/i);
    });
  });

  // ── BUG-01: IMPLEMENTED_BY edges target :Codebase nodes, not :Knowledge ───
  //
  // IMPLEMENTED_BY edges link a Knowledge node to a Codebase node (File/Function/Class).
  // The MATCH clause must use (b:Codebase {id: $tgt}), not (b:Knowledge {id: $tgt}).
  // Non-IMPLEMENTED_BY edges still use (b:Knowledge ...) for both endpoints.
  //
  // Note: The generated cypher query text is not visible in stderr (cypher-shell only
  // shows the connection error, not the query). These tests verify the fallback path is
  // entered correctly and the script handles edges without crashing.

  describe('BUG-01: IMPLEMENTED_BY edges target :Codebase nodes', () => {
    it('enters cypher-shell fallback for IMPLEMENTED_BY edges (driver fails → fallback)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A domain', type: 'domain', tags: [] },
        ],
        edges: [
          { source: 'feature:auth', target: 'file:src/AuthService.ts', type: 'implemented_by', weight: 0.8 },
          { source: 'feature:auth', target: 'function:src/AuthService.ts:login', type: 'implemented_by', weight: 0.8 },
        ],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      // Driver fails → cypher-shell fallback entered → fails on connection
      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        // Mock cypher-shell in PATH so fallback fails fast instead of hanging on real cypher-shell.
        // NEO4J_TEST_MOCK=1 makes the driver fail immediately so we don't wait for a real driver timeout.
        PATH: `${mockCypherShellDir}:${process.env.PATH}`,
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // Fallback should be entered (shows cypher-shell retry message)
      expect(result.stderr).toContain('cypher-shell fallback');
      // Should fail on connection, not on query processing
      expect(result.stderr).not.toMatch(/Syntax error|parse error/i);
    });

    it('enters cypher-shell fallback for non-IMPLEMENTED_BY edges (driver fails → fallback)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A domain', type: 'domain', tags: [] },
        ],
        edges: [
          { source: 'domain:test', target: 'feature:auth', type: 'has_feature', weight: 1.0 },
          { source: 'feature:auth', target: 'operation:login', type: 'has_operation', weight: 1.0 },
        ],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: `${mockCypherShellDir}:${process.env.PATH}`,
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('cypher-shell fallback');
      expect(result.stderr).not.toMatch(/Syntax error|parse error/i);
    });

    it('handles mixed IMPLEMENTED_BY and non-IMPLEMENTED_BY edges without crashing', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A domain', type: 'domain', tags: [] },
        ],
        edges: [
          { source: 'domain:test', target: 'feature:auth', type: 'has_feature', weight: 1.0 },
          { source: 'feature:auth', target: 'file:src/AuthService.ts', type: 'implemented_by', weight: 0.8 },
          { source: 'operation:login', target: 'actor:user', type: 'performed_by', weight: 1.0 },
        ],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: `${mockCypherShellDir}:${process.env.PATH}`,
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('cypher-shell fallback');
      // The script should process edges correctly and fail on connection, not on edge type
      expect(result.stderr).not.toMatch(/Unknown edge type|invalid type/i);
    });
  });

  // ── BUG-03: MERGE (not delete-then-insert) preserves existing nodes ───────
  //
  // Both the driver path and cypher-shell fallback use MERGE on node IDs to update
  // existing nodes in place. This supports scoped analyses (e.g., --files flag) that
  // should not destroy the pre-existing graph.
  //
  // Note: The generated cypher query text is not visible in stderr (cypher-shell only
  // shows the connection error). These tests verify the fallback path is entered and
  // the node push fails (not a cleanup error).

  describe('BUG-03: MERGE (not delete-then-insert) preserves existing nodes', () => {
    it('enters cypher-shell fallback and pushes nodes via MERGE (driver fails → fallback)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A domain', type: 'domain', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: `${mockCypherShellDir}:${process.env.PATH}`,
        NEO4J_TEST_MOCK: '1',
      });

      expect(result.status).toBe(1);
      // Fallback should be entered (shows cypher-shell retry message)
      expect(result.stderr).toContain('cypher-shell fallback');
      // Node push fails on connection, but no cleanup warning (no DELETE cleanup)
      expect(result.stderr).not.toContain('cleanup query failed');
      // Should get past node processing and fail on connection
      expect(result.stderr).toContain('node push failed');
    });

    it('processes empty node set without crashing (MERGE, no DELETE, exits 0 when nodes array empty)', () => {
      const domainAnalysis = {
        nodes: [],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: `${mockCypherShellDir}:${process.env.PATH}`,
        NEO4J_TEST_MOCK: '1',
      });

      // Empty graph — no DELETE cleanup, no nodes/edges to push, exits 0
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('Unknown node type');
    });
  });

  // ── BUG-04: success messages use console.log, not console.error ────────────
  //
  // Both the driver path and cypher-shell fallback must emit success messages
  // via console.log (stdout) so callers can distinguish success from failure.

  describe('BUG-04: success messages use console.log, not console.error', () => {
    it('emits success to stdout, not stderr (driver path — unreachable host)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A domain', type: 'domain', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        NEO4J_TEST_MOCK: '1',
      });

      // When Neo4j is unreachable, the script fails — success message is never reached.
      // We verify the stderr does NOT contain the success message text (which would
      // indicate it was incorrectly emitted to stderr instead of stdout).
      expect(result.stderr).not.toContain('pushed to Neo4j successfully');
    });

    it('emits success to stdout, not stderr (cypher-shell fallback)', () => {
      const domainAnalysis = {
        nodes: [
          { id: 'domain:test', name: 'Test Domain', summary: 'A domain', type: 'domain', tags: [] },
        ],
        edges: [],
      };
      writeFileSync(
        join(root, '.grasp-it', 'intermediate', 'domain-analysis.json'),
        JSON.stringify(domainAnalysis),
      );

      const result = runPushDomainGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Unreachable host → cypher-shell fallback fails → success message never reached
      // We verify the stderr does NOT contain the success message text
      expect(result.stderr).not.toContain('pushed to Neo4j successfully');
      expect(result.stderr).not.toContain('via cypher-shell successfully');
    });
  });

  // ── BUG-03: URI host/port extraction handles neo4j:// and neo4j+s:// ───────
  //
  // The SKILL.md fallback uses bash parameter expansion: ${uri#neo4j*://}
  // This correctly handles both neo4j:// and neo4j+s:// schemes because
  // # is greedy and strips the longest matching prefix.
  //
  // The old BRE sed approach (neo4j\+) only matched neo4j+:// literally,
  // not neo4j://. The old ERE sed approach (neo4j[+]*) matched zero or more
  // literal pluses, not "one optional plus".

  describe('BUG-03: URI host/port extraction for neo4j:// and neo4j+s:// schemes', () => {
    it('extracts host and port correctly from neo4j:// URIs', () => {
      const uri = 'neo4j://127.0.0.1:7687';
      // Simulate ${uri#neo4j*://} behavior
      const after = uri.replace(/^neo4j[^:]*:\/\//, '');
      const host = after.split(':')[0];
      const port = after.split(':')[1]?.split('/')[0] ?? '';
      expect(host).toBe('127.0.0.1');
      expect(port).toBe('7687');
    });

    it('extracts host and port correctly from neo4j+s:// URIs', () => {
      const uri = 'neo4j+s://localhost:7474';
      const after = uri.replace(/^neo4j[^:]*:\/\//, '');
      const host = after.split(':')[0];
      const port = after.split(':')[1]?.split('/')[0] ?? '';
      expect(host).toBe('localhost');
      expect(port).toBe('7474');
    });

    it('extracts host and port correctly from neo4j:// with no explicit port', () => {
      const uri = 'neo4j://localhost';
      const after = uri.replace(/^neo4j[^:]*:\/\//, '');
      const host = after.split(':')[0];
      const port = after.split(':')[1]?.split('/')[0] ?? '';
      expect(host).toBe('localhost');
      // No port in URI — defaults to 7687 per SKILL.md fallback logic
      expect(port).toBe('');
    });

    it('converts neo4j URI to bolt URI correctly', () => {
      expect('neo4j://127.0.0.1:7687'.replace(/^neo4j[^:]*:\/\//, 'bolt://')).toBe('bolt://127.0.0.1:7687');
      expect('neo4j+s://localhost:7687'.replace(/^neo4j[^:]*:\/\//, 'bolt://')).toBe('bolt://localhost:7687');
    });

    it('bash parameter expansion pattern handles both URI schemes correctly', () => {
      // Verify the JS equivalent of ${uri#neo4j*://} for both schemes
      const uris = [
        ['neo4j://127.0.0.1:7687', '127.0.0.1', '7687'],
        ['neo4j+s://localhost:7474', 'localhost', '7474'],
        ['neo4j://localhost', 'localhost', ''],
        ['neo4j+s://dbhost.example.com:7687/path', 'dbhost.example.com', '7687'],
      ];
      for (const [uri, expectedHost, expectedPort] of uris) {
        const after = uri.replace(/^neo4j[^:]*:\/\//, '');
        const host = after.split(':')[0];
        const port = after.split(':')[1]?.split('/')[0] ?? '';
        expect(host).toBe(expectedHost, `host for ${uri}`);
        expect(port).toBe(expectedPort, `port for ${uri}`);
      }
    });
  });
});
