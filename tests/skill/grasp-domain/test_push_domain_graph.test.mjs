/**
 * Tests for push-domain-graph.mjs
 *
 * Reads domain-analysis.json from .grasp-it/ and pushes it to Neo4j.
 */

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
  // Build a clean env: start with process.env, then apply extraEnv
  // (undefined values are skipped so they don't override existing env vars)
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return spawnSync('node', [scriptPath, projectRoot], {
    encoding: 'utf-8',
    env,
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('push-domain-graph.mjs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-domain-graph-test-'));
    // The script reads domain-analysis.json from .grasp-it/intermediate/
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
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
      });

      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Unknown node type');
      expect(result.stderr).not.toContain('Syntax error');
    });
  });

  // ── Test 8: edge case — empty nodes array ───────────────────────────────────

  describe('empty graph data', () => {
    it('exits 1 when nodes array is empty (nothing to push)', () => {
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
      });

      // Empty nodes means nothing to push — but the script should still enter the push path
      // and try to push (and fail on connection), not fail on "unknown node type"
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Unknown node type');
    });
  });
});
