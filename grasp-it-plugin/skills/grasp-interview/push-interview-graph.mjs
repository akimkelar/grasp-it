#!/usr/bin/env node
/**
 * push-interview-graph.mjs
 *
 * Reads pr-nodes.json and pr-edges.json from .grasp-it/intermediate/ and pushes
 * interview knowledge to Neo4j using the Knowledge + specific label pattern.
 *
 * Fully self-contained — uses only neo4j-driver (no TypeScript imports).
 *
 * Usage:
 *   node push-interview-graph.mjs <project-root>
 *
 * Arguments:
 *   project-root  — root of the project being analyzed
 *
 * Exit codes:
 *   0 — success
 *   1 — failure (file not found, Neo4j error, etc.)
 *
 * All interview nodes carry generatedAt (ISO timestamp). They do NOT carry
 * sourceCommit or sourceFiles — those are only present on code-analysis nodes.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "child_process";
import { getNeo4jConfig, getConnectionType } from "../../skills/grasp/neo4j-config-loader.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const INTERMEDIATE_DIR = ".grasp-it/intermediate";
const NODES_FILE = "pr-nodes.json";
const EDGES_FILE = "pr-edges.json";

const TYPE_TO_LABEL = {
  feature: "Feature",
  operation: "Operation",
  actor: "Actor",
  "business-rule": "BusinessRule",
  entity: "Entity",
  decision: "Decision",
  constraint: "Constraint",
  concept: "Concept",
  claim: "Claim",
  risk: "Risk",
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
      if (!secondaryLabel) {
        console.error(`push-interview-graph.mjs: Unknown node type '${node.type}' for node '${node.id}'. Known types: ${Object.keys(TYPE_TO_LABEL).join(", ")}`);
        continue;
      }

      const props = {
        id: node.id,
        name: node.name || "",
        summary: node.summary || "",
        kind: "knowledge",
        source: "interview",
        type: node.type,
        tags: node.tags || [],
        generatedAt: node.generatedAt || new Date().toISOString(),
        author: node.author || "",
      };
      if (node.status) props.status = node.status;
      if (node.complexity) props.complexity = node.complexity;
      if (node.severity) props.severity = node.severity;
      if (node.probability) props.probability = node.probability;
      if (node.mitigation) props.mitigation = node.mitigation;
      if (node.condition) props.condition = node.condition;
      if (node.invariant) props.invariant = node.invariant;
      if (node.ruleText) props.ruleText = node.ruleText;
      if (node.rationale) props.rationale = node.rationale;
      if (node.confidence) props.confidence = node.confidence;
      if (node.scope) props.scope = node.scope;
      if (node.permissions) props.permissions = node.permissions;
      if (node.restrictions) props.restrictions = node.restrictions;

      const setParts = Object.entries(props)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `${k}: ${cypherEscape(JSON.stringify(v))}`;
          return `${k}: ${cypherEscape(v)}`;
        })
        .join(", ");

      // Dual-label pattern: MERGE Knowledge base label, then add secondary label
      // Using backtick escaping for the secondary label which may contain special chars
      lines.push(
        `MERGE (n:Knowledge {id: ${cypherEscape(node.id)}}) SET n += {${setParts}} SET n:\`${secondaryLabel}\`;`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Build a cypher-shell query string for pushing edges.
 * Converts relationship type to UPPER_SNAKE_CASE.
 */
function buildEdgesCypher(graphData) {
  const lines = [];
  if (graphData.edges && Array.isArray(graphData.edges)) {
    for (const edge of graphData.edges) {
      const relType = edge.type.toUpperCase().replace(/-/g, "_");
      lines.push(
        `MATCH (a:Knowledge {id: ${cypherEscape(edge.source)}}), (b:Knowledge {id: ${cypherEscape(edge.target)}}) MERGE (a)-[r:\`${relType}\` {weight: ${edge.weight || 1.0}}]->(b);`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Push interview graph using cypher-shell (fallback when driver is unavailable).
 */
function pushInterviewGraphViaCypherShell(neo4jConfig, graphData) {
  // Push nodes
  const nodesCypher = buildNodesCypher(graphData, neo4jConfig);
  if (nodesCypher) {
    const result = runCypherShell(neo4jConfig, nodesCypher);
    if (!result.ok) {
      console.error(`push-interview-graph.mjs: cypher-shell node push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Push edges
  const edgesCypher = buildEdgesCypher(graphData);
  if (edgesCypher) {
    const result = runCypherShell(neo4jConfig, edgesCypher);
    if (!result.ok) {
      console.error(`push-interview-graph.mjs: cypher-shell edge push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Ensure layer exists
  const layerCypher = `MATCH (n:Knowledge {source: 'interview'}) WITH collect(n.id) AS nodeIds
MERGE (l:Layer {id: 'layer:knowledge'}) SET l.nodeIds = nodeIds;`;
  runCypherShell(neo4jConfig, layerCypher); // best-effort — don't fail if Layer doesn't exist

  // Orphan check via cypher-shell
  const orphanQuery = `MATCH (n:Knowledge) WHERE NOT (n:Feature OR n:Operation OR n:Actor OR n:BusinessRule OR n:Entity OR n:Decision OR n:Constraint OR n:Concept OR n:Claim OR n:Risk) RETURN n.id AS id, n.type AS type;`;
  try {
    const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;
    const uri = NEO4J_URI || "neo4j://localhost:7687";
    const cypherUri = uri.replace(/^neo4j\+?:\/\//, "bolt://");
    const database = neo4jConfig.NEO4J_DATABASE || "grasp";
    const output = execFileSync(
      "cypher-shell",
      ["-a", cypherUri, "-u", NEO4J_USERNAME || "neo4j", "-p", NEO4J_PASSWORD || "password", "-d", database, "--format", "plain"],
      { input: orphanQuery, encoding: "utf-8" }
    );
    const lines = output.trim().split("\n").filter(l => l && !l.startsWith("+"));
    for (const line of lines) {
      try {
        const [id, type] = line.split("\t");
        if (id) {
          console.error(`push-interview-graph.mjs: WARNING — node has no secondary label: ${id} (type: ${type})`);
        }
      } catch {}
    }
  } catch {
    // Orphan check is best-effort
  }

  console.log("push-interview-graph.mjs: Interview graph pushed to Neo4j via cypher-shell successfully.");
  process.exit(0);
}

// ── Main push logic ─────────────────────────────────────────────────────────────

async function pushInterviewGraph(projectRoot) {
  const nodesPath = join(projectRoot, INTERMEDIATE_DIR, NODES_FILE);
  const edgesPath = join(projectRoot, INTERMEDIATE_DIR, EDGES_FILE);

  if (!existsSync(nodesPath)) {
    console.error(`push-interview-graph.mjs: Nodes file not found at ${nodesPath}`);
    process.exit(1);
  }

  if (!existsSync(edgesPath)) {
    console.error(`push-interview-graph.mjs: Edges file not found at ${edgesPath}`);
    process.exit(1);
  }

  let nodesData, edgesData;
  try {
    const nodesContent = readFileSync(nodesPath, "utf-8");
    nodesData = JSON.parse(nodesContent);
  } catch (err) {
    console.error(`push-interview-graph.mjs: Failed to read/parse nodes file: ${err.message}`);
    process.exit(1);
  }

  try {
    const edgesContent = readFileSync(edgesPath, "utf-8");
    edgesData = JSON.parse(edgesContent);
  } catch (err) {
    console.error(`push-interview-graph.mjs: Failed to read/parse edges file: ${err.message}`);
    process.exit(1);
  }

  const graphData = {
    nodes: nodesData.nodes || [],
    edges: edgesData.edges || [],
  };

  // Validate all nodes have a known type and map to a secondary label
  if (graphData.nodes && Array.isArray(graphData.nodes)) {
    for (const node of graphData.nodes) {
      const derivedType = node.type || (node.id ? node.id.split(":")[0] : null);
      if (!TYPE_TO_LABEL[derivedType]) {
        console.error(`push-interview-graph.mjs: Unknown node type '${derivedType}' for node '${node.id}'. Known types: ${Object.keys(TYPE_TO_LABEL).join(", ")}`);
        process.exit(1);
      }
    }
  }

  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    console.error("push-interview-graph.mjs: No Neo4j configuration found");
    process.exit(1);
  }

  // Try driver first; fall back to cypher-shell if driver is unavailable
  let driver;
  let driverAvailable = false;
  try {
    // Test mode: use a mock driver that fails predictably
    if (process.env.NEO4J_TEST_MOCK === '1') {
      throw new Error('Connection refused (TestMock)');
    }
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      neo4jConfig.NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(neo4jConfig.NEO4J_USERNAME || "neo4j", neo4jConfig.NEO4J_PASSWORD || "password"),
    );
    driverAvailable = true;
  } catch (err) {
    console.error(`push-interview-graph.mjs: neo4j-driver not available (${err.message}) — will use cypher-shell fallback.`);
  }

  if (!driverAvailable) {
    pushInterviewGraphViaCypherShell(neo4jConfig, graphData);
    return; // never reached
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" });

    // Push nodes with dual labels: Knowledge + specific type label
    if (graphData.nodes && Array.isArray(graphData.nodes)) {
      for (const node of graphData.nodes) {
        const derivedType = node.type || (node.id ? node.id.split(":")[0] : null);
        const secondaryLabel = TYPE_TO_LABEL[derivedType];
        if (!secondaryLabel) {
          throw new Error(`Node ${node.id} has unknown type: ${derivedType}`);
        }

        const props = {
          id: node.id,
          name: node.name || "",
          summary: node.summary || "",
          kind: "knowledge",
          source: "interview",
          type: node.type,
          tags: node.tags || [],
          generatedAt: node.generatedAt || new Date().toISOString(),
          author: node.author || "",
        };
        if (node.status) props.status = node.status;
        if (node.complexity) props.complexity = node.complexity;
        if (node.severity) props.severity = node.severity;
        if (node.probability) props.probability = node.probability;
        if (node.mitigation) props.mitigation = node.mitigation;
        if (node.condition) props.condition = node.condition;
        if (node.invariant) props.invariant = node.invariant;
        if (node.ruleText) props.ruleText = node.ruleText;
        if (node.rationale) props.rationale = node.rationale;
        if (node.confidence) props.confidence = node.confidence;
        if (node.scope) props.scope = node.scope;
        if (node.permissions) props.permissions = node.permissions;
        if (node.restrictions) props.restrictions = node.restrictions;

        // Dual-label pattern: MERGE Knowledge base label, then add secondary label
        await session.run(
          `MERGE (n:Knowledge {id: $id}) SET n += $props SET n:\`${secondaryLabel}\``,
          { id: node.id, props }
        );
      }
    }

    // Push edges with correct relationship type (UPPER_SNAKE_CASE)
    if (graphData.edges && Array.isArray(graphData.edges)) {
      for (const edge of graphData.edges) {
        const relType = edge.type.toUpperCase().replace(/-/g, "_");
        await session.run(
          `MATCH (a:Knowledge {id: $src}), (b:Knowledge {id: $tgt})
           MERGE (a)-[r:\`${relType}\` {weight: $w}]->(b)`,
          { src: edge.source, tgt: edge.target, w: edge.weight || 1.0 }
        );
      }
    }

    // Ensure layer exists
    await session.run(
      `MATCH (n:Knowledge {source: 'interview'}) WITH collect(n.id) AS nodeIds
       MERGE (l:Layer {id: 'layer:knowledge'}) SET l.nodeIds = nodeIds`
    );

    await session.close();

    // Post-push validation: check no node has only Knowledge without secondary label
    const orphanCheck = await driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" }).run(
      `MATCH (n:Knowledge)
       WHERE NOT (n:Feature OR n:Operation OR n:Actor OR n:BusinessRule OR n:Entity OR n:Decision OR n:Constraint OR n:Concept OR n:Claim OR n:Risk)
       RETURN n.id AS id, n.type AS type`
    );
    const orphans = orphanCheck.records.map(r => ({ id: r.get("id"), type: r.get("type") }));
    if (orphans.length > 0) {
      console.error(`push-interview-graph.mjs: WARNING — ${orphans.length} node(s) have no secondary label:`);
      for (const o of orphans) {
        console.error(`  ${o.id} (type: ${o.type})`);
      }
    }

    console.log("push-interview-graph.mjs: Interview graph pushed to Neo4j successfully.");
    process.exit(0);
  } catch (err) {
    console.error(`push-interview-graph.mjs: Failed to push interview graph: ${err.message}`);
    // Driver failed — try cypher-shell as last resort
    if (err.message.includes("neo4j-driver") ||
        err.message.includes("Connection refused") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("No routing servers available") ||
        err.message.includes("ServiceUnavailable") ||
        err.message.includes("Security error") ||
        !driverAvailable) {
      console.error("push-interview-graph.mjs: Retrying via cypher-shell fallback...");
      pushInterviewGraphViaCypherShell(neo4jConfig, graphData);
    }
    process.exit(1);
  } finally {
    if (driver) await driver.close();
  }
}

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Usage: node push-interview-graph.mjs <project-root>");
  process.exit(1);
}

pushInterviewGraph(projectRoot).catch((err) => {
  console.error(`push-interview-graph.mjs: Unexpected error: ${err.message}`);
  process.exit(1);
});