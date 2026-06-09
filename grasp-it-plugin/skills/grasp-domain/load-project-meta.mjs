#!/usr/bin/env node
/**
 * load-project-meta.mjs
 *
 * Loads the Project singleton node from Neo4j and outputs its properties as JSON.
 *
 * Usage:
 *   node load-project-meta.mjs <project-root>
 *
 * Arguments:
 *   project-root  — root of the project being analyzed
 *
 * Exit codes:
 *   0 — success (JSON printed to stdout)
 *   1 — connection/query failure or no Project singleton found
 */

import { getNeo4jConfig } from "./neo4j-config-loader.mjs";

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Usage: node load-project-meta.mjs <project-root>");
  process.exit(1);
}

const neo4jConfig = getNeo4jConfig(projectRoot);
if (!neo4jConfig) {
  console.error("load-project-meta.mjs: No Neo4j configuration found");
  process.exit(1);
}

const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = neo4jConfig;

async function loadProjectMeta() {
  let driver;
  try {
    const { default: neo4j } = await import("neo4j-driver");
    driver = neo4j.driver(
      NEO4J_URI || "neo4j://localhost:7687",
      neo4j.auth.basic(NEO4J_USERNAME || "neo4j", NEO4J_PASSWORD || "password"),
    );
  } catch (err) {
    console.error(`load-project-meta.mjs: Failed to load neo4j-driver: ${err.message}`);
    process.exit(1);
  }

  try {
    const session = driver.session();
    const result = await session.run(
      "MATCH (p:Project {id: 'project:singleton'}) RETURN p"
    );
    await session.close();

    if (result.records.length === 0) {
      console.error("load-project-meta.mjs: No Project singleton found");
      process.exit(1);
    }

    const record = result.records[0];
    const node = record.get("p");

    // Convert Neo4j Integer, Date, etc. to plain values
    const obj = {};
    node.keys.forEach((key) => {
      const value = node.get(key);
      if (value && typeof value.toString === "function" && value.constructor.name !== "String" && value.constructor.name !== "Number") {
        obj[key] = value.toString();
      } else if (Array.isArray(value)) {
        obj[key] = value.map((v) =>
          v && typeof v.toString === "function" && v.constructor.name !== "String" && v.constructor.name !== "Number"
            ? v.toString()
            : v
        );
      } else {
        obj[key] = value;
      }
    });

    console.log(JSON.stringify(obj));
    process.exit(0);
  } catch (err) {
    console.error(`load-project-meta.mjs: Query failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (driver) await driver.close();
  }
}

loadProjectMeta();
