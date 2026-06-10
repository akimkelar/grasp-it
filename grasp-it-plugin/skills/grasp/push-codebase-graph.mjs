#!/usr/bin/env node
/**
 * push-codebase-graph.mjs
 *
 * Reads assembled-graph.json from .grasp-it/intermediate/ and pushes the
 * codebase nodes and edges to Neo4j using the Codebase grouping label pattern.
 *
 * Fully self-contained — uses only neo4j-driver (no TypeScript imports).
 *
 * Usage:
 *   node push-codebase-graph.mjs <project-root>
 *
 * Arguments:
 *   project-root  — root of the project being analyzed
 *
 * Exit codes:
 *   0 — success
 *   1 — failure (file not found, Neo4j error, etc.)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "child_process";
import { getNeo4jConfig, getConnectionType } from "./neo4j-config-loader.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const INTERMEDIATE_DIR = ".grasp-it/intermediate";
const ASSEMBLED_GRAPH_FILE = "assembled-graph.json";

// Node type -> Neo4j label mapping
const TYPE_TO_LABEL = {
  file: "File",
  function: "Function",
  class: "Class",
  module: "Module",
  config: "Config",
  document: "Document",
  service: "Service",
  table: "Table",
  endpoint: "Endpoint",
  pipeline: "Pipeline",
  schema: "Schema",
  resource: "Resource",
};

const VALID_SECONDARY_LABELS = new Set(Object.values(TYPE_TO_LABEL));

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Escape a string value for safe inline use in cypher-shell queries.
 * Handles single quotes, backslashes, and null bytes.
 */
function cypherEscape(value) {
  if (value == null) return "null";
  const str = String(value);
  return "'" + str.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

/**
 * Run a cypher-shell command with the given Neo4j config and query.
 * Returns { ok: true } on success, { ok: false, reason } on failure.
 */
function runCypherShell(neo4jConfig, query) {
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;
  const uri = NEO4J_URI || "neo4j://localhost:7687";
  const cypherUri = uri.replace(/^neo4j\+?:\/\//, "bolt://");
  const database = neo4jConfig.NEO4J_DATABASE || "grasp";

  try {
    execFileSync(
      "cypher-shell",
      [
        "-a", cypherUri,
        "-u", NEO4J_USERNAME || "neo4j",
        "-p", NEO4J_PASSWORD || "password",
        "-d", database,
        "--format", "plain",
      ],
      { input: query, encoding: "utf-8" }
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Build a cypher-shell query string for pushing nodes.
 */
function buildNodesCypher(graphData, neo4jConfig) {
  const lines = [];
  if (graphData.nodes && Array.isArray(graphData.nodes)) {
    for (const node of graphData.nodes) {
      const secondaryLabel = TYPE_TO_LABEL[node.type];
      if (!secondaryLabel) continue;

      const props = {
        id: node.id,
        name: node.name || "",
        type: node.type,
        summary: node.summary || "",
        kind: "codebase",
        tags: node.tags || [],
      };
      if (node.filePath) props.filePath = node.filePath;
      if (node.lineRange) props.lineRange = node.lineRange;
      if (node.complexity) props.complexity = node.complexity;
      if (node.languageNotes) props.languageNotes = node.languageNotes;

      const setParts = Object.entries(props)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `n.${k} = ${cypherEscape(JSON.stringify(v))}`;
          return `n.${k} = ${cypherEscape(v)}`;
        })
        .join(", ");

      // Dual-label pattern: MERGE Codebase base label, then add secondary label
      lines.push(
        `MERGE (n:Codebase {id: ${cypherEscape(node.id)}}) SET n += {${setParts}} SET n:\`${secondaryLabel}\`;`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Build a cypher-shell query string for pushing edges.
 */
function buildEdgesCypher(graphData) {
  const lines = [];
  if (graphData.edges && Array.isArray(graphData.edges)) {
    for (const edge of graphData.edges) {
      // Use RELATES for all edges with type as a property
      const edgeProps = [
        `type: ${cypherEscape(edge.type)}`,
        `direction: ${cypherEscape(edge.direction)}`,
        `weight: ${edge.weight || 1.0}`,
      ];
      if (edge.description) {
        edgeProps.push(`description: ${cypherEscape(edge.description)}`);
      }
      const propsStr = edgeProps.join(", ");

      lines.push(
        `MATCH (a:Codebase {id: ${cypherEscape(edge.source)}}), (b:Codebase {id: ${cypherEscape(edge.target)}}) MERGE (a)-[r:RELATES {${propsStr}}]->(b);`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Push codebase graph using cypher-shell (fallback when driver is unavailable).
 */
function pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta) {
  // Clear existing codebase nodes first
  const clearQuery = `MATCH (n:Codebase) DETACH DELETE n;`;
  const clearResult = runCypherShell(neo4jConfig, clearQuery);
  if (!clearResult.ok) {
    console.error(`push-codebase-graph.mjs: cypher-shell clear failed: ${clearResult.reason}`);
    process.exit(1);
  }

  // Push nodes
  const nodesCypher = buildNodesCypher(graphData, neo4jConfig);
  if (nodesCypher) {
    const result = runCypherShell(neo4jConfig, nodesCypher);
    if (!result.ok) {
      console.error(`push-codebase-graph.mjs: cypher-shell node push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Push edges
  const edgesCypher = buildEdgesCypher(graphData);
  if (edgesCypher) {
    const result = runCypherShell(neo4jConfig, edgesCypher);
    if (!result.ok) {
      console.error(`push-codebase-graph.mjs: cypher-shell edge push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Update Project singleton with gitCommitHash, lastAnalyzedAt, version, analyzedFiles
  const fileCount = (graphData.nodes || []).filter(n => n.type === "file").length;
  const updateProjectCypher = `MATCH (p:Project {id: 'project:singleton'}) SET p.gitCommitHash = ${cypherEscape(projectMeta.gitCommitHash)}, p.lastAnalyzedAt = datetime(), p.version = ${cypherEscape(projectMeta.version || "1.0.0")}, p.analyzedFiles = ${fileCount};`;
  runCypherShell(neo4jConfig, updateProjectCypher); // best-effort

  console.error("push-codebase-graph.mjs: Codebase graph pushed to Neo4j via cypher-shell successfully.");
  process.exit(0);
}

// ── Main push logic ─────────────────────────────────────────────────────────────

async function pushCodebaseGraph(projectRoot) {
  const assembledGraphPath = join(projectRoot, INTERMEDIATE_DIR, ASSEMBLED_GRAPH_FILE);

  if (!existsSync(assembledGraphPath)) {
    console.error(`push-codebase-graph.mjs: Assembled graph file not found at ${assembledGraphPath}`);
    process.exit(1);
  }

  let graphData;
  try {
    const content = readFileSync(assembledGraphPath, "utf-8");
    graphData = JSON.parse(content);
  } catch (err) {
    console.error(`push-codebase-graph.mjs: Failed to read/parse assembled graph: ${err.message}`);
    process.exit(1);
  }

  // Extract project metadata
  const projectMeta = {
    gitCommitHash: graphData.project?.gitCommitHash || "",
    version: graphData.version || "1.0.0",
  };

  // Count file nodes for analyzedFiles
  const fileCount = (graphData.nodes || []).filter(n => n.type === "file").length;

  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    console.error("push-codebase-graph.mjs: No Neo4j configuration found");
    process.exit(1);
  }

  // Try driver first; fall back to cypher-shell if driver is unavailable
  let driver;
  let driverAvailable = false;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      neo4jConfig.NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(neo4jConfig.NEO4J_USERNAME || "neo4j", neo4jConfig.NEO4J_PASSWORD || "password"),
    );
    driverAvailable = true;
  } catch (err) {
    console.error(`push-codebase-graph.mjs: neo4j-driver not available (${err.message}) — will use cypher-shell fallback.`);
  }

  if (!driverAvailable) {
    pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta);
    return; // never reached
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" });

    // Clear existing codebase nodes first
    await session.run(`MATCH (n:Codebase) DETACH DELETE n`);

    // Push nodes with dual labels: Codebase + specific type label
    if (graphData.nodes && Array.isArray(graphData.nodes)) {
      for (const node of graphData.nodes) {
        const secondaryLabel = TYPE_TO_LABEL[node.type];
        if (!secondaryLabel) {
          console.error(`push-codebase-graph.mjs: Unknown node type '${node.type}' for node '${node.id}'. Skipping.`);
          continue;
        }

        const props = {
          id: node.id,
          name: node.name || "",
          type: node.type,
          summary: node.summary || "",
          kind: "codebase",
          tags: node.tags || [],
        };
        if (node.filePath) props.filePath = node.filePath;
        if (node.lineRange) props.lineRange = node.lineRange;
        if (node.complexity) props.complexity = node.complexity;
        if (node.languageNotes) props.languageNotes = node.languageNotes;

        // Dual-label pattern: MERGE Codebase base label, then add secondary label
        await session.run(
          `MERGE (n:Codebase {id: $id}) SET n += $props SET n:\`${secondaryLabel}\``,
          { id: node.id, props }
        );
      }
    }

    // Push edges with RELATES relationship type
    if (graphData.edges && Array.isArray(graphData.edges)) {
      for (const edge of graphData.edges) {
        const edgeProps = {
          type: edge.type,
          direction: edge.direction,
          weight: edge.weight || 1.0,
        };
        if (edge.description) edgeProps.description = edge.description;

        await session.run(
          `MATCH (a:Codebase {id: $src}), (b:Codebase {id: $tgt})
           MERGE (a)-[r:RELATES]->(b)
           SET r += $props`,
          { src: edge.source, tgt: edge.target, props: edgeProps }
        );
      }
    }

    // Update Project singleton with metadata
    await session.run(
      `MERGE (p:Project {id: 'project:singleton'})
       SET p.gitCommitHash = $gitCommitHash,
           p.lastAnalyzedAt = datetime(),
           p.version = $version,
           p.analyzedFiles = $analyzedFiles,
           p.kind = "project"`,
      {
        gitCommitHash: projectMeta.gitCommitHash,
        version: projectMeta.version || "1.0.0",
        analyzedFiles: fileCount,
      }
    );

    await session.close();
    console.error("push-codebase-graph.mjs: Codebase graph pushed to Neo4j successfully.");
    process.exit(0);
  } catch (err) {
    console.error(`push-codebase-graph.mjs: Failed to push codebase graph: ${err.message}`);
    // Driver failed — try cypher-shell as last resort
    if (err.message.includes("neo4j-driver") || !driverAvailable) {
      console.error("push-codebase-graph.mjs: Retrying via cypher-shell fallback...");
      pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta);
    }
    process.exit(1);
  } finally {
    if (driver) await driver.close();
  }
}

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Usage: node push-codebase-graph.mjs <project-root>");
  process.exit(1);
}

pushCodebaseGraph(projectRoot).catch((err) => {
  console.error(`push-codebase-graph.mjs: Unexpected error: ${err.message}`);
  process.exit(1);
});