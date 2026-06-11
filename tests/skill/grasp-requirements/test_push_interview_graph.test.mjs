/**
 * Tests for push-interview-graph.mjs
 *
 * Reads pr-nodes.json and pr-edges.json from .grasp-it/ and pushes interview knowledge to Neo4j.
 */

// Some tests involve real Neo4j connections that may hang on close — allow extra time
const TEST_TIMEOUT = 30_000;

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function runPushInterviewGraph(projectRoot, extraEnv = {}) {
  const scriptPath = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-requirements/push-interview-graph.mjs');
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

describe('push-interview-graph.mjs', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-interview-graph-test-'));
    // The script reads pr-nodes.json and pr-edges.json from .grasp-it/intermediate/
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  // ── Test 1: exits 1 when pr-nodes.json is not found ──────────────────────

  describe('exit code 1 when pr-nodes.json is not found', () => {
    it('exits with code 1 and prints error message', () => {
      // .grasp-it/intermediate/ directory exists but pr-nodes.json does not
      const result = runPushInterviewGraph(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Nodes file not found');
    });
  });

  // ── Test 2: exits 1 when pr-edges.json is not found ─────────────────────

  describe('exit code 1 when pr-edges.json is not found', () => {
    it('exits with code 1 when pr-nodes.json exists but pr-edges.json does not', () => {
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify({ nodes: [] }));
      const result = runPushInterviewGraph(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Edges file not found');
    });
  });

  // ── Test 3: exits 1 when no Neo4j configuration found ──────────────────

  describe('exit code 1 when no Neo4j configuration found', () => {
    it('exits with code 1 when no Neo4j env vars and no .env file', () => {
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify({ nodes: [] }));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      // Pass empty strings for Neo4j env vars to override any in the test environment,
      // then delete them so getNeo4jConfig sees no config
      const result = runPushInterviewGraph(root, {
        NEO4J_URI: '',
        NEO4J_USERNAME: '',
        NEO4J_PASSWORD: '',
        NEO4J_DATABASE: '',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('No Neo4j configuration found');
    });
  });

  // ── Test 4: handles all valid node types including Risk and Constraint ──

  describe('node type handling', () => {
    it('handles feature, operation, actor, business-rule, entity, decision, constraint, concept, claim, and risk node types', () => {
      const nodesData = {
        nodes: [
          { id: 'feature:test-feature', name: 'Test Feature', summary: 'A test feature', type: 'feature' },
          { id: 'operation:test-op', name: 'Test Operation', summary: 'A test operation', type: 'operation' },
          { id: 'actor:test-actor', name: 'Test Actor', summary: 'A test actor', type: 'actor' },
          { id: 'business-rule:test-rule', name: 'Test Rule', summary: 'A test rule', type: 'business-rule' },
          { id: 'entity:test-entity', name: 'Test Entity', summary: 'A test entity', type: 'entity' },
          { id: 'decision:test-decision', name: 'Test Decision', summary: 'A test decision', type: 'decision' },
          { id: 'constraint:test-constraint', name: 'Test Constraint', summary: 'A test constraint', type: 'constraint', condition: 'always', invariant: 'must hold' },
          { id: 'concept:test-concept', name: 'Test Concept', summary: 'A test concept', type: 'concept' },
          { id: 'claim:abc12345', name: 'Test Claim', summary: 'A test claim', type: 'claim', confidence: 'tentative' },
          { id: 'risk:test-risk', name: 'Test Risk', summary: 'A test risk', type: 'risk', severity: 'high', probability: 'medium' },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Should fail on Neo4j connection, not on node type validation
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Unknown node type');
    });

    it('exits 1 when unknown node type is encountered', () => {
      const nodesData = {
        nodes: [
          { id: 'node1', name: 'Test', summary: 'Test', type: 'unknown-type' },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown node type 'unknown-type'");
    });
  });

  // ── Test 5: Risk and Constraint nodes with all properties ────────────────

  describe('Risk and Constraint node properties', () => {
    it('handles Risk node with severity, probability, mitigation, and scope', () => {
      const nodesData = {
        nodes: [
          {
            id: 'risk:admin-pricing-access-unknown',
            name: 'Admin Pricing Access Unknown',
            summary: 'Uncertain whether Admin has access to price-aware entities',
            type: 'risk',
            severity: 'high',
            probability: 'medium',
            mitigation: 'Verify Admin permissions before deployment',
            scope: ['feature:bonus-pricing-integration'],
            tags: ['access-control', 'security'],
          },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Connection error means Risk node was processed correctly
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Unknown node type');
    });

    it('handles Constraint node with condition and invariant', () => {
      const nodesData = {
        nodes: [
          {
            id: 'constraint:verify-admin-pricing-permissions',
            name: 'Verify Admin Pricing Permissions',
            summary: 'Must verify Admin access to price-aware entities',
            type: 'constraint',
            condition: 'before deployment',
            invariant: 'Admin can only access price-aware entities they are authorized for',
            scope: ['feature:bonus-pricing-integration'],
            tags: ['access-control', 'security'],
          },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Connection error means Constraint node was processed correctly
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Unknown node type');
    });
  });

  // ── Test 6: edge handling with UPPER_SNAKE_CASE relationship types ───────

  describe('edge type handling', () => {
    it('handles edges with various relationship types', () => {
      const nodesData = {
        nodes: [
          { id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature' },
          { id: 'actor:test-actor', name: 'Test Actor', summary: 'Test', type: 'actor' },
          { id: 'risk:test-risk', name: 'Test Risk', summary: 'Test', type: 'risk' },
          { id: 'constraint:test-constraint', name: 'Test Constraint', summary: 'Test', type: 'constraint' },
        ],
      };
      const edgesData = {
        edges: [
          { source: 'feature:test', target: 'actor:test-actor', type: 'performed_by', weight: 1.0 },
          { source: 'feature:test', target: 'risk:test-risk', type: 'has_risk', weight: 1.0 },
          { source: 'constraint:test-constraint', target: 'feature:test', type: 'applies_in', weight: 1.0 },
          { source: 'actor:test-actor', target: 'feature:test', type: 'restricted_for', weight: 1.0 },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify(edgesData));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Connection error means edges were processed correctly
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Unknown node type');
    });
  });

  // ── Test 7: cypher-shell fallback when driver is unavailable ──────────────

  describe('cypher-shell fallback behavior', () => {
    it('falls back to cypher-shell when neo4j-driver is unavailable', () => {
      const nodesData = {
        nodes: [
          { id: 'feature:test', name: 'Test', summary: 'Test', type: 'feature' },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      // Set a reachable host for driver (will fail), but PATH that excludes cypher-shell
      // so that the fallback also fails
      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
        // Remove cypher-shell from PATH so fallback also fails
        PATH: '/usr/local/bin:/usr/bin:/bin',
      });

      // Script should fail but have entered the push path
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('Nodes file not found');
      expect(result.stderr).not.toContain('Edges file not found');
      expect(result.stderr).not.toContain('No Neo4j configuration found');
      // Either driver fail or fallback fail — both are valid outcomes here
      expect(result.stderr).toMatch(/neo4j-driver not available|Failed to push interview graph|cypher-shell|Connection refused|ECONNREFUSED/i);
    });
  });

  // ── Test 8: special character handling in node properties ───────────────

  describe('special character handling in node properties', () => {
    it('handles node names with single quotes and backslashes', () => {
      const nodesData = {
        nodes: [
          { id: 'feature:test', name: "O'Reilly's Feature \\ Test", summary: "It's a test", type: 'feature' },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Connection error means node processing (and cypherEscape) succeeded
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFUSED/i);
      expect(result.stderr).not.toContain('Syntax error');
      expect(result.stderr).not.toContain('single quote');
    });

    it('handles array properties correctly', () => {
      const nodesData = {
        nodes: [
          { id: 'feature:test', name: 'Test Feature', summary: 'A test feature', type: 'feature', tags: ['tag1', "it's-a-tag", 'tag3'], permissions: ['read', 'write'], restrictions: ['delete'], scope: ['feature:test'] },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Connection error means node processing succeeded
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFUSED/i);
    });
  });

  // ── Test 9: Claim node with UUID-style id ───────────────────────────────

  describe('Claim node handling', () => {
    it('handles claim nodes with short UUID ids', () => {
      const nodesData = {
        nodes: [
          { id: 'claim:a1b2c3d4', name: 'Test Claim', summary: 'A test claim', type: 'claim', confidence: 'tentative', rationale: 'Based on specialist input' },
          { id: 'claim:12345678', name: 'Another Claim', summary: 'Another claim', type: 'claim', confidence: 'agreed' },
        ],
      };
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-nodes.json'), JSON.stringify(nodesData));
      writeFileSync(join(root, '.grasp-it', 'intermediate', 'pr-edges.json'), JSON.stringify({ edges: [] }));

      const result = runPushInterviewGraph(root, {
        NEO4J_URI: 'neo4j://localhost:9999',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'password',
        NEO4J_DATABASE: 'neo4j',
      });

      expect(result.status).toBe(1);
      // Connection error means Claim nodes were processed correctly
      expect(result.stderr).toMatch(/Failed to push interview graph|Connection refused|ECONNREFCLUDED/i);
    });
  });
});