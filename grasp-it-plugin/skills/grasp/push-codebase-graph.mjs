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
 * Convert an internal edge type string to a Neo4j relationship type (UPPER_SNAKE_CASE).
 */
export function toRelType(type) {
  return (type || 'RELATED').toUpperCase().replace(/-/g, '_');
}

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
  const cypherUri = uri
    .replace(/^neo4j\+s:\/\//, "bolt+s://")
    .replace(/^neo4j:\/\//, "bolt://");
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
      { input: query, encoding: "utf-8", timeout: 10_000 }
    );
    return { ok: true };
  } catch (err) {
    if (err.code === "ENOENT" || (err.message && err.message.includes("ENOENT"))) {
      return { ok: false, reason: "cypher-shell not found. Install it: brew install cypher-shell (macOS), apt install cypher-shell (Linux), or see https://neo4j.com/deployment-center/" };
    }
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
        generatedAt: node.generatedAt || new Date().toISOString(),
      };
      if (node.filePath) props.filePath = node.filePath;
      if (node.lineRange) props.lineRange = node.lineRange;
      if (node.complexity) props.complexity = node.complexity;
      if (node.languageNotes) props.languageNotes = node.languageNotes;
      if (node.sourceCommit) props.sourceCommit = node.sourceCommit;

      const setParts = Object.entries(props)
        .map(([k, v]) => {
          if (Array.isArray(v)) return `${k}: [${v.map(item => cypherEscape(String(item))).join(', ')}]`;
          return `${k}: ${cypherEscape(v)}`;
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
export function buildEdgesCypher(graphData) {
  const lines = [];
  if (graphData.edges && Array.isArray(graphData.edges)) {
    for (const edge of graphData.edges) {
      const relType = toRelType(edge.type);
      const edgeProps = [
        `direction: ${cypherEscape(edge.direction)}`,
        `weight: ${edge.weight || 1.0}`,
      ];
      if (edge.description) edgeProps.push(`description: ${cypherEscape(edge.description)}`);
      const propsStr = edgeProps.join(", ");

      lines.push(
        `MATCH (a:Codebase {id: ${cypherEscape(edge.source)}}), (b:Codebase {id: ${cypherEscape(edge.target)}}) MERGE (a)-[r:\`${relType}\`]->(b) SET r += {${propsStr}};`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Build a cypher-shell query string for pushing Layer nodes and :IN_LAYER edges.
 */
export function buildLayersCypher(graphData) {
  const lines = [];
  if (graphData.layers && Array.isArray(graphData.layers)) {
    for (const layer of graphData.layers) {
      lines.push(
        `MERGE (l:Layer:Codebase {id: ${cypherEscape(layer.id)}}) SET l += {name: ${cypherEscape(layer.name || "")}, description: ${cypherEscape(layer.description || "")}, kind: "codebase"};`
      );
      if (layer.nodeIds && Array.isArray(layer.nodeIds)) {
        for (const nodeId of layer.nodeIds) {
          lines.push(
            `MATCH (l:Layer:Codebase {id: ${cypherEscape(layer.id)}}), (n:Codebase {id: ${cypherEscape(nodeId)}}) WHERE n.kind = "codebase" MERGE (l)-[r:IN_LAYER]->(n) SET r += {weight: 1.0};`
          );
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * Push codebase graph using cypher-shell (fallback when driver is unavailable).
 */
function pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta) {
  // Push nodes — use MERGE (not delete-then-insert) so existing nodes outside
  // the assembled graph scope are preserved. This supports scoped analyses
  // (e.g., --files flag) that should not destroy the pre-existing graph.
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

  // Push layers
  const layersCypher = buildLayersCypher(graphData);
  if (layersCypher) {
    const result = runCypherShell(neo4jConfig, layersCypher);
    if (!result.ok) {
      console.error(`push-codebase-graph.mjs: cypher-shell layer push failed: ${result.reason}`);
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

// ── Retry helper ──────────────────────────────────────────────────────────────

/**
 * Returns true for errors that are transient connection/DNS failures worth retrying.
 */
function isRetryable(err) {
  if (err.code === "ServiceUnavailable") return true;
  const msg = err.message || "";
  return (
    msg.includes("ENOTFOUND") ||
    msg.includes("EAI_AGAIN") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("getaddrinfo")
  );
}

/**
 * Retry an async function up to `retries` times on retryable errors.
 * Logs each failed attempt to stderr.
 *
 * @param {() => Promise<any>} fn - Async function to call
 * @param {{ retries?: number, delayMs?: number, label?: string }} options
 */
async function withRetry(fn, { retries = 3, delayMs = 2000, label = "push-codebase-graph.mjs" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isRetryable(err) && attempt < retries) {
        const reason = err.message || String(err);
        process.stderr.write(
          `${label}: Connection attempt ${attempt}/${retries} failed (${reason}). Retrying in ${delayMs / 1000}s...\n`
        );
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
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

  // Check connection type — if cypher-shell is requested, use it directly
  const connectionType = getConnectionType();
  if (connectionType === "cypher-shell") {
    pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta);
    return; // never reached
  }

  // Try driver first; fall back to cypher-shell if driver is unavailable
  let driver;
  let driverAvailable = false;
  // Counter for NEO4J_TEST_MOCK_FAIL_TIMES: how many connection attempts should fail before succeeding
  let mockFailsRemaining = process.env.NEO4J_TEST_MOCK_FAIL_TIMES
    ? parseInt(process.env.NEO4J_TEST_MOCK_FAIL_TIMES, 10)
    : null;
  try {
    // Test mode: use a mock driver that fails predictably
    if (process.env.NEO4J_TEST_MOCK === '1') {
      throw new Error('Connection refused (TestMock)');
    }
    // Test mode: controlled failure count or auth fail — use a stub driver to avoid real network activity
    if (mockFailsRemaining !== null || process.env.NEO4J_TEST_MOCK_AUTH_FAIL === '1') {
      driver = {
        verifyConnectivity: async () => {},
        session: () => ({ run: async () => ({ records: [] }), close: async () => {} }),
        close: async () => {},
      };
      driverAvailable = true;
    } else {
      const { default: neo4j } = await import("neo4j-driver");
      driver = neo4j.driver(
        neo4jConfig.NEO4J_URI || "neo4j://localhost:7687",
        neo4j.auth.basic(neo4jConfig.NEO4J_USERNAME || "neo4j", neo4jConfig.NEO4J_PASSWORD || "password"),
      );
      driverAvailable = true;
    }
  } catch (err) {
    console.error(`push-codebase-graph.mjs: neo4j-driver not available (${err.message}) — will use cypher-shell fallback.`);
  }

  if (!driverAvailable) {
    pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta);
    return; // never reached
  }

  // Extract hostname from URI for DNS error messages
  const neo4jUri = neo4jConfig.NEO4J_URI || "neo4j://localhost:7687";
  let neo4jHostname = "localhost";
  try {
    neo4jHostname = new URL(neo4jUri.replace(/^neo4j(\+ssc?)?:\/\//, "bolt://")).hostname;
  } catch { /* ignore */ }

  // Allow tests to override retry delay so tests run fast
  const retryDelayMs = process.env.NEO4J_RETRY_DELAY_MS
    ? parseInt(process.env.NEO4J_RETRY_DELAY_MS, 10)
    : 2000;

  /**
   * One connection attempt: verify connectivity, open session, run all queries, close session.
   */
  async function runDriverAttempt() {
    // Test mode with controlled failure count (simulate transient DNS failures)
    if (mockFailsRemaining !== null && mockFailsRemaining > 0) {
      mockFailsRemaining--;
      const mockErr = new Error("ENOTFOUND mock.host.invalid (TestMock)");
      mockErr.code = "ServiceUnavailable";
      throw mockErr;
    }
    // NEO4J_TEST_MOCK_FAIL_TIMES=N: after N failures, succeed immediately (no real DB calls)
    if (mockFailsRemaining !== null && mockFailsRemaining === 0) {
      return; // simulate successful push
    }
    if (process.env.NEO4J_TEST_MOCK_AUTH_FAIL === '1') {
      const authErr = new Error("The client is unauthorized due to authentication failure.");
      authErr.code = "Neo.ClientError.Security.Unauthorized";
      throw authErr;
    }

    // Pre-flight connectivity check — surfaces DNS/connection failures early
    await driver.verifyConnectivity();

    const session = driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" });
    try {
      // Push nodes with dual labels: Codebase + specific type label
      // Use MERGE (not delete-then-insert) so existing nodes outside the
      // assembled graph scope are preserved. This supports scoped analyses
      // (e.g., --files flag) that should not destroy the pre-existing graph.
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
            generatedAt: node.generatedAt || new Date().toISOString(),
          };
          if (node.filePath) props.filePath = node.filePath;
          if (node.lineRange) props.lineRange = node.lineRange;
          if (node.complexity) props.complexity = node.complexity;
          if (node.languageNotes) props.languageNotes = node.languageNotes;
          if (node.sourceCommit) props.sourceCommit = node.sourceCommit;

          // Dual-label pattern: MERGE Codebase base label, then add secondary label
          await session.run(
            `MERGE (n:Codebase {id: $id}) SET n += $props SET n:\`${secondaryLabel}\``,
            { id: node.id, props }
          );
        }
      }

      // Push edges with named relationship types (UPPER_SNAKE_CASE of edge.type)
      if (graphData.edges && Array.isArray(graphData.edges)) {
        for (const edge of graphData.edges) {
          const relType = toRelType(edge.type);
          const edgeProps = {
            direction: edge.direction,
            weight: edge.weight || 1.0,
          };
          if (edge.description) edgeProps.description = edge.description;

          await session.run(
            `MATCH (a:Codebase {id: $src}), (b:Codebase {id: $tgt})
             MERGE (a)-[r:\`${relType}\`]->(b)
             SET r += $props`,
            { src: edge.source, tgt: edge.target, props: edgeProps }
          );
        }
      }

      // Push Layer nodes and :IN_LAYER edges
      if (graphData.layers && Array.isArray(graphData.layers)) {
        for (const layer of graphData.layers) {
          // MERGE the Layer node with dual labels: Layer + Codebase
          await session.run(
            `MERGE (l:Layer:Codebase {id: $layerId})
             SET l += {name: $name, description: $description, kind: "codebase"}`,
            {
              layerId: layer.id,
              name: layer.name || "",
              description: layer.description || "",
            }
          );
          // MERGE :IN_LAYER edges from layer to each nodeId
          if (layer.nodeIds && Array.isArray(layer.nodeIds)) {
            for (const nodeId of layer.nodeIds) {
              await session.run(
                `MATCH (l:Layer:Codebase {id: $layerId}), (n:Codebase {id: $nodeId})
                 WHERE n.kind = "codebase"
                 MERGE (l)-[r:IN_LAYER]->(n)
                 SET r += {weight: 1.0}`,
                { layerId: layer.id, nodeId }
              );
            }
          }
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
    } finally {
      await session.close();
    }
  }

  try {
    await withRetry(runDriverAttempt, { retries: 3, delayMs: retryDelayMs, label: "push-codebase-graph.mjs" });
    console.error("push-codebase-graph.mjs: Codebase graph pushed to Neo4j successfully.");
    process.exit(0);
  } catch (err) {
    console.error(`push-codebase-graph.mjs: Failed to push codebase graph: ${err.message}`);
    // Emit a specific DNS diagnostic before falling back
    const errMsg = err.message || "";
    if (errMsg.includes("ENOTFOUND") || errMsg.includes("EAI_AGAIN") || errMsg.includes("getaddrinfo")) {
      process.stderr.write(
        `push-codebase-graph.mjs: DNS resolution failed for ${neo4jHostname}.\n` +
        `If running in a container or sandbox (e.g. Codex), ensure the container's DNS\n` +
        `can resolve this hostname. Set NEO4J_CONNECTION_TYPE=cypher-shell as a workaround\n` +
        `if cypher-shell is installed.\n`
      );
    }
    // Driver failed — try cypher-shell as last resort
    if (isRetryable(err) ||
        errMsg.includes("neo4j-driver") ||
        errMsg.includes("Connection refused") ||
        errMsg.includes("No routing servers available") ||
        errMsg.includes("ServiceUnavailable") ||
        errMsg.includes("Security error") ||
        !driverAvailable) {
      console.error("push-codebase-graph.mjs: Retrying via cypher-shell fallback...");
      pushCodebaseGraphViaCypherShell(neo4jConfig, graphData, projectMeta);
    }
    process.exit(1);
  } finally {
    if (driver) await driver.close();
  }
}

// Only run as a CLI script — skip when imported as a module (e.g., in tests)
const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === (process.argv[1].startsWith('/') ? process.argv[1] : new URL(process.argv[1], 'file://').pathname);

if (isMain) {
  const projectRoot = process.argv[2];

  if (!projectRoot) {
    console.error("Usage: node push-codebase-graph.mjs <project-root>");
    process.exit(1);
  }

  pushCodebaseGraph(projectRoot).catch((err) => {
    console.error(`push-codebase-graph.mjs: Unexpected error: ${err.message}`);
    process.exit(1);
  });
}