#!/usr/bin/env node
/**
 * push-domain-graph.mjs
 *
 * Reads domain-analysis.json from .grasp-it/intermediate/ and pushes it to Neo4j
 * using the dual-label pattern (DomainElement + specific label).
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

const INTERMEDIATE_DIR = ".grasp-it";
const DOMAIN_ANALYSIS_FILE = "domain-analysis.json";

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
  // The domain-analyzer agent may produce `label`/`description` instead of `name`/`summary`.
  // Accept both naming conventions and normalize to the canonical `name`/`summary` fields.
  if (graphData.nodes && Array.isArray(graphData.nodes)) {
    for (const node of graphData.nodes) {
      // Normalize label -> name (backward compatibility with older agent output)
      if ("label" in node && !("name" in node)) {
        node.name = node.label;
        delete node.label;
      }
      // Normalize description -> summary (backward compatibility with older agent output)
      if ("description" in node && !("summary" in node)) {
        node.summary = node.description;
        delete node.description;
      }
    }
  }

  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    console.error("push-domain-graph.mjs: No Neo4j configuration found");
    process.exit(1);
  }

  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch (err) {
    console.error(`push-domain-graph.mjs: Failed to load neo4j-driver: ${err.message}`);
    process.exit(1);
  }

  try {
    const session = driver.session();

    // Dynamically import the save function from core
    const { saveDomainGraphToNeo4j } = await import(
      `${__dirname}../../packages/core/src/persistence/index.js`
    );

    await saveDomainGraphToNeo4j(session, graphData);

    await session.close();
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
