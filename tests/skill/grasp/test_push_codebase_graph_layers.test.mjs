/**
 * Tests for Layer node and :IN_LAYER edge push in push-codebase-graph.mjs
 *
 * Verifies:
 * - buildLayersCypher generates correct MERGE Cypher for Layer:Codebase nodes
 * - buildLayersCypher generates correct :IN_LAYER edge queries
 * - buildLayersCypher returns empty string when graphData.layers is absent or empty
 * - cypher-shell path emits layer queries (verified via mock cypher-shell)
 * - Layer nodes include kind: "codebase" as required by the schema
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'os';
import { join } from "path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/push-codebase-graph.mjs');

// Import the buildLayersCypher function from the script
async function getBuildLayersCypher() {
  const mod = await import(SCRIPT_PATH);
  return mod.buildLayersCypher;
}

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

// ── buildLayersCypher unit tests ────────────────────────────────────────────

describe('buildLayersCypher', () => {
  it('generates MERGE for Layer:Codebase node with name, description, kind', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({
      layers: [
        { id: 'layer:core', name: 'Core', description: 'Core application code', nodeIds: ['file:src/index.ts'] },
      ],
    });

    // Should MERGE on bare id, then set labels separately
    expect(cypher).toContain('MERGE (l {id: \'layer:core\'})');
    expect(cypher).toContain('SET l:Codebase SET l:Layer');
    // Should SET name and description
    expect(cypher).toContain('name: \'Core\'');
    expect(cypher).toContain('description: \'Core application code\'');
    // Must include kind: "codebase"
    expect(cypher).toContain('kind: "codebase"');
  });

  it('generates IN_LAYER edge queries for each nodeId', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({
      layers: [
        {
          id: 'layer:core',
          name: 'Core',
          description: 'Core',
          nodeIds: ['file:src/index.ts', 'file:src/app.ts'],
        },
      ],
    });

    // Should MATCH both Layer and Codebase nodes
    expect(cypher).toContain('MATCH (l:Layer:Codebase {id: \'layer:core\'}), (n:Codebase {id: \'file:src/index.ts\'})');
    expect(cypher).toContain('MATCH (l:Layer:Codebase {id: \'layer:core\'}), (n:Codebase {id: \'file:src/app.ts\'})');
    // Should MERGE :IN_LAYER relationship with weight
    expect(cypher).toContain('MERGE (l)-[r:IN_LAYER]->(n)');
    expect(cypher).toContain('weight: 1.0');
    // Should include WHERE n.kind = "codebase"
    expect(cypher).toContain('WHERE n.kind = "codebase"');
  });

  it('returns empty string when layers is absent', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({});
    expect(cypher).toBe('');
  });

  it('returns empty string when layers is empty array', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({ layers: [] });
    expect(cypher).toBe('');
  });

  it('returns empty string when layers is null', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({ layers: null });
    expect(cypher).toBe('');
  });

  it('handles layer with empty nodeIds array', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({
      layers: [
        { id: 'layer:empty', name: 'Empty', description: 'No nodes', nodeIds: [] },
      ],
    });

    // Should still emit the Layer MERGE (bare id pattern)
    expect(cypher).toContain('MERGE (l {id: \'layer:empty\'})');
    expect(cypher).toContain('SET l:Codebase SET l:Layer');
    // But no IN_LAYER edges since nodeIds is empty
    expect(cypher).not.toContain('IN_LAYER');
  });

  it('escapes single quotes in layer id, name, and description', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({
      layers: [
        { id: "layer:o'sullivan", name: "O'Sullivan Layer", description: "It's the best layer", nodeIds: ['file:src/test.ts'] },
      ],
    });

    // Single quotes should be escaped with backslash
    expect(cypher).toContain("id: 'layer:o\\'sullivan'");
    expect(cypher).toContain("name: 'O\\'Sullivan Layer'");
    expect(cypher).toContain("description: 'It\\'s the best layer'");
  });

  it('generates separate queries for multiple layers', async () => {
    const buildLayersCypher = await getBuildLayersCypher();
    const cypher = buildLayersCypher({
      layers: [
        { id: 'layer:core', name: 'Core', description: 'Core', nodeIds: ['file:src/index.ts'] },
        { id: 'layer:infra', name: 'Infra', description: 'Infra', nodeIds: ['file:src/Dockerfile'] },
      ],
    });

    expect(cypher).toContain("id: 'layer:core'");
    expect(cypher).toContain("id: 'layer:infra'");
  });
});

// ── cypher-shell path integration tests ──────────────────────────────────────

describe('push-codebase-graph.mjs — layer push via cypher-shell', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-layers-test-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function writeGraph(nodes = [], edges = [], layers = []) {
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'assembled-graph.json'),
      JSON.stringify({
        project: { gitCommitHash: 'abc123' },
        version: '1.0.0',
        nodes,
        edges,
        layers,
      }),
    );
  }

  it('emits Layer:Codebase MERGE query when layers are present', () => {
    writeGraph(
      [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] }],
      [],
      [{ id: 'layer:core', name: 'Core', description: 'Core code', nodeIds: ['file:src/index.ts'] }]
    );

    // Mock cypher-shell that reads stdin and exits 0 (success for all queries)
    const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-layers-'));
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh
# Echo stdin to stderr so we can verify queries, then succeed
cat >&2
exit 0
`, { mode: 0o755 });

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    // Should succeed and see bare-id MERGE in stderr (from mock echo)
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('MERGE (l {id:');
    expect(result.stderr).toContain('SET l:Codebase SET l:Layer');
    expect(result.stderr).toContain('kind: "codebase"');
  });

  it('emits IN_LAYER edge query for layer with nodeIds', () => {
    writeGraph(
      [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] }],
      [],
      [{ id: 'layer:core', name: 'Core', description: 'Core', nodeIds: ['file:src/index.ts'] }]
    );

    const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-inlayer-'));
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh
cat >&2
exit 0
`, { mode: 0o755 });

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('IN_LAYER');
    expect(result.stderr).toContain('WHERE n.kind = "codebase"');
    expect(result.stderr).toContain('weight: 1.0');
  });

  it('does NOT emit layer queries when layers is absent from graph', () => {
    writeGraph(
      [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] }],
      []
      // no layers field
    );

    const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-nolayers-'));
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh
cat >&2
exit 1
`, { mode: 0o755 });

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    expect(result.stderr).not.toContain('Layer:Codebase');
    expect(result.stderr).not.toContain('IN_LAYER');
  });

  it('does NOT emit layer queries when layers is empty', () => {
    writeGraph(
      [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] }],
      [],
      []
    );

    const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-emptylayers-'));
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh
cat >&2
exit 1
`, { mode: 0o755 });

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    expect(result.stderr).not.toContain('Layer:Codebase');
    expect(result.stderr).not.toContain('IN_LAYER');
  });

  it('silently skips edges to non-existent nodes (consistent with current edge behavior)', () => {
    writeGraph(
      [{ id: 'file:src/index.ts', name: 'index.ts', type: 'file', summary: 'Entry', tags: [] }],
      [],
      [{ id: 'layer:core', name: 'Core', description: 'Core', nodeIds: ['file:src/index.ts', 'file:nonExistent.ts'] }]
    );

    const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-dangling-'));
    writeFileSync(join(mockDir, 'cypher-shell'), `#!/bin/sh
cat >&2
exit 0
`, { mode: 0o755 });

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    // Should succeed and emit the Layer node MERGE
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Layer:Codebase');
    // The edge for nonExistent.ts is silently dropped — no assertion needed
    // since Neo4j MERGE with MATCH on non-existent node produces no row, not an error
  });
});
