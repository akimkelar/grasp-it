#!/usr/bin/env node
/**
 * push-domain-graph.mjs
 *
 * Reads domain-analysis.json from .grasp-it/intermediate/ and pushes it to Neo4j
 * using the dual-label pattern (DomainElement + specific label).
 *
 * Fully self-contained — uses only neo4j-driver (no TypeScript imports).
 *
 * Usage:
 *   node push-domain-graph.mjs <project-root>
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
import { getNeo4jConfig } from "./neo4j-config-loader.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const INTERMEDIATE_DIR = ".grasp-it/intermediate";
const DOMAIN_ANALYSIS_FILE = "domain-analysis.json";

const TYPE_TO_LABEL = {
  domain: "Domain",
  feature: "Feature",
  operation: "Operation",
  actor: "Actor",
  entity: "Entity",
  "business-rule": "BusinessRule",
};

const VALID_SECONDARY_LABELS = new Set(Object.values(TYPE_TO_LABEL));

async function pushDomainGraph(projectRoot) {
  const domainAnalysisPath = join(projectRoot, INTERMEDIATE_DIR, DOMAIN_ANALYSIS_FILE);

  if (!existsSync(domainAnalysisPath)) {
    console.error(`push-domain-graph.mjs: Domain analysis file not found at ${domainAnalysisPath}`);
    process.exit(1);
  }

  let graphData;
  try {
    const content = readFileSync(domainAnalysisPath, "utf-8");
    graphData = JSON.parse(content);
  } catch (err) {
    console.error(`push-domain-graph.mjs: Failed to read/parse domain analysis: ${err.message}`);
    process.exit(1);
  }

  // Normalize field names for backward compatibility.
  if (graphData.nodes && Array.isArray(graphData.nodes)) {
    for (const node of graphData.nodes) {
      if ("label" in node && !("name" in node)) {
        node.name = node.label;
        delete node.label;
      }
      if ("description" in node && !("summary" in node)) {
        node.summary = node.description;
        delete node.description;
      }
    }
  }

  // Validate all nodes have a known type and map to a secondary label
  if (graphData.nodes && Array.isArray(graphData.nodes)) {
    for (const node of graphData.nodes) {
      if (!TYPE_TO_LABEL[node.type]) {
        console.error(`push-domain-graph.mjs: Unknown node type '${node.type}' for node '${node.id}'. Known types: ${Object.keys(TYPE_TO_LABEL).join(", ")}`);
        process.exit(1);
      }
    }
  }

  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    console.error("push-domain-graph.mjs: No Neo4j configuration found");
    process.exit(1);
  }

  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      neo4jConfig.NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(neo4jConfig.NEO4J_USERNAME || "neo4j", neo4jConfig.NEO4J_PASSWORD || "password"),
    );
  } catch (err) {
    console.error(`push-domain-graph.mjs: Failed to load neo4j-driver: ${err.message}`);
    process.exit(1);
  }

  try {
    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" });

    // Push nodes with dual labels: DomainElement + specific type label
    if (graphData.nodes && Array.isArray(graphData.nodes)) {
      for (const node of graphData.nodes) {
        const secondaryLabel = TYPE_TO_LABEL[node.type];
        if (!secondaryLabel) {
          throw new Error(`Node ${node.id} has unknown type: ${node.type}`);
        }

        const props = {
          id: node.id,
          name: node.name || "",
          summary: node.summary || "",
          kind: "knowledge",
          source: "code-analysis",
          type: node.type,
          tags: node.tags || [],
        };
        if (node.complexity) props.complexity = node.complexity;
        if (node.status) props.status = node.status;

        // Dual-label pattern: MERGE DomainElement base label, then add secondary label
        // Using backtick escaping for the secondary label which may contain special chars
        await session.run(
          `MERGE (n:DomainElement {id: $id}) SET n += $props SET n:\`${secondaryLabel}\``,
          { id: node.id, props }
        );
      }
    }

    // Push edges with correct relationship type
    if (graphData.edges && Array.isArray(graphData.edges)) {
      for (const edge of graphData.edges) {
        const relType = edge.type.toUpperCase().replace(/-/g, "_");
        await session.run(
          `MATCH (a:DomainElement {id: $src}), (b:DomainElement {id: $tgt})
           MERGE (a)-[r:\`${relType}\` {weight: $w}]->(b)`,
          { src: edge.source, tgt: edge.target, w: edge.weight || 1.0 }
        );
      }
    }

    // Update Project singleton domainCommit
    await session.run(
      `MATCH (p:Project {id: 'project:singleton'})
       SET p.domainAnalyzedAt = datetime(), p.domainCommit = p.gitCommitHash`
    );

    await session.close();

    // Post-push validation: check no node has only DomainElement without secondary label
    const orphanCheck = await driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" }).run(
      `MATCH (n:DomainElement)
       WHERE NOT (n:Domain OR n:Feature OR n:Operation OR n:Actor OR n:Entity OR n:BusinessRule)
       RETURN n.id AS id, n.type AS type`
    );
    const orphans = orphanCheck.records.map(r => ({ id: r.get("id"), type: r.get("type") }));
    if (orphans.length > 0) {
      console.error(`push-domain-graph.mjs: WARNING — ${orphans.length} node(s) have no secondary label:`);
      for (const o of orphans) {
        console.error(`  ${o.id} (type: ${o.type})`);
      }
    }

    console.error("push-domain-graph.mjs: Domain graph pushed to Neo4j successfully.");
    process.exit(0);
  } catch (err) {
    console.error(`push-domain-graph.mjs: Failed to push domain graph: ${err.message}`);
    process.exit(1);
  } finally {
    if (driver) await driver.close();
  }
}

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Usage: node push-domain-graph.mjs <project-root>");
  process.exit(1);
}

pushDomainGraph(projectRoot).catch((err) => {
  console.error(`push-domain-graph.mjs: Unexpected error: ${err.message}`);
  process.exit(1);
});