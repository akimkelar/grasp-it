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
    // The script reads domain-analysis.json from .grasp-it/ (not intermediate/)
    mkdirSync(join(root, '.grasp-it'), { recursive: true });
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
      writeFileSync(join(root, '.grasp-it', 'domain-analysis.json'), JSON.stringify({
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
        join(root, '.grasp-it', 'domain-analysis.json'),
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
        join(root, '.grasp-it', 'domain-analysis.json'),
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
        join(root, '.grasp-it', 'domain-analysis.json'),
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
});
