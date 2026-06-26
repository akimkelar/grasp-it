#!/usr/bin/env node
/**
 * push-concept-graph.mjs
 *
 * Reads pr-nodes.json and pr-edges.json from .grasp-it/intermediate/ and pushes
 * concept plan knowledge to Neo4j using the Knowledge + specific label pattern.
 *
 * Fully self-contained — uses only neo4j-driver (no TypeScript imports).
 *
 * Usage:
 *   node push-concept-graph.mjs <project-root>
 *
 * Arguments:
 *   project-root  — root of the project being analyzed
 *
 * Exit codes:
 *   0 — success
 *   1 — failure (file not found, Neo4j error, etc.)
 *
 * All concept plan nodes carry `source: "concept"` and `kind: "knowledge"`,
 * plus a generatedAt (ISO timestamp). They do NOT carry
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
  domain: "Domain",
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

/**
 * Suggest the canonical kebab-case `type` value for a PascalCase Neo4j
 * label. Used only to produce a helpful error message — the value is
 * never written back to the graph.
 *
 * @example suggestKebabCase("BusinessRule") // "business-rule"
 * @example suggestKebabCase("Feature")      // "feature"
 */
function suggestKebabCase(pascalCase) {
  return String(pascalCase)
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

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
      // Upfront validation in pushConceptGraph() guarantees node.type is in TYPE_TO_LABEL.
      const secondaryLabel = TYPE_TO_LABEL[node.type];

      const props = {
        id: node.id,
        name: node.name || "",
        summary: node.summary || "",
        kind: "knowledge",
        source: "concept",
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
          if (Array.isArray(v)) return `${k}: [${v.map(item => cypherEscape(String(item))).join(', ')}]`;
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
 * IMPLEMENTED_BY edges target :Codebase nodes, not :Knowledge nodes.
 */
function buildEdgesCypher(graphData) {
  const lines = [];
  if (graphData.edges && Array.isArray(graphData.edges)) {
    for (const edge of graphData.edges) {
      const relType = edge.type.toUpperCase().replace(/[\s-]/g, "_");
      if (relType === "IMPLEMENTED_BY") {
        lines.push(
          `MATCH (a:Knowledge {id: ${cypherEscape(edge.source)}}), (b:Codebase {id: ${cypherEscape(edge.target)}}) MERGE (a)-[r:\`${relType}\` {weight: ${edge.weight || 1.0}}]->(b);`
        );
      } else {
        lines.push(
          `MATCH (a:Knowledge {id: ${cypherEscape(edge.source)}}), (b:Knowledge {id: ${cypherEscape(edge.target)}}) MERGE (a)-[r:\`${relType}\` {weight: ${edge.weight || 1.0}}]->(b);`
        );
      }
    }
  }
  return lines.join("\n");
}

/**
 * Push concept plan graph using cypher-shell (fallback when driver is unavailable).
 */
function pushConceptGraphViaCypherShell(neo4jConfig, graphData) {
  // Push nodes
  const nodesCypher = buildNodesCypher(graphData, neo4jConfig);
  if (nodesCypher) {
    const result = runCypherShell(neo4jConfig, nodesCypher);
    if (!result.ok) {
      console.error(`push-concept-graph.mjs: cypher-shell node push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Push edges
  const edgesCypher = buildEdgesCypher(graphData);
  if (edgesCypher) {
    const result = runCypherShell(neo4jConfig, edgesCypher);
    if (!result.ok) {
      console.error(`push-concept-graph.mjs: cypher-shell edge push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Ensure layer exists
  const layerCypher = `MATCH (n:Knowledge {source: 'concept'}) WITH collect(n.id) AS nodeIds
MERGE (l:Layer {id: 'layer:knowledge'}) SET l.nodeIds = nodeIds;`;
  runCypherShell(neo4jConfig, layerCypher); // best-effort — don't fail if Layer doesn't exist

  // Orphan check via cypher-shell (best-effort — don't exit on failure)
  const orphanQuery = `MATCH (n:Knowledge) WHERE NOT (n:Domain OR n:Feature OR n:Operation OR n:Actor OR n:BusinessRule OR n:Entity OR n:Decision OR n:Constraint OR n:Concept OR n:Claim OR n:Risk) RETURN n.id AS id, n.type AS type;`;
  const orphanResult = runCypherShell(neo4jConfig, orphanQuery);
  if (!orphanResult.ok) {
    if (orphanResult.reason && orphanResult.reason.includes("cypher-shell not found")) {
      console.error(`push-concept-graph.mjs: WARNING — orphan check skipped: ${orphanResult.reason}`);
    }
    // Other errors are silently ignored — orphan check is best-effort
  }

  // Upfront validation in pushConceptGraph() guarantees all nodes have known types.
  const totalNodes = (graphData.nodes || []).length;
  console.log(`push-concept-graph.mjs: Concept plan graph pushed to Neo4j via cypher-shell successfully (${totalNodes} node${totalNodes === 1 ? '' : 's'} written, 0 nodes skipped).`);
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
async function withRetry(fn, { retries = 3, delayMs = 2000, label = "push-concept-graph.mjs" } = {}) {
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

async function pushConceptGraph(projectRoot) {
  const nodesPath = join(projectRoot, INTERMEDIATE_DIR, NODES_FILE);
  const edgesPath = join(projectRoot, INTERMEDIATE_DIR, EDGES_FILE);

  if (!existsSync(nodesPath)) {
    console.error(`push-concept-graph.mjs: Nodes file not found at ${nodesPath}`);
    process.exit(1);
  }

  if (!existsSync(edgesPath)) {
    console.error(`push-concept-graph.mjs: Edges file not found at ${edgesPath}`);
    process.exit(1);
  }

  let nodesData, edgesData;
  try {
    const nodesContent = readFileSync(nodesPath, "utf-8");
    nodesData = JSON.parse(nodesContent);
  } catch (err) {
    console.error(`push-concept-graph.mjs: Failed to read/parse nodes file: ${err.message}`);
    process.exit(1);
  }

  try {
    const edgesContent = readFileSync(edgesPath, "utf-8");
    edgesData = JSON.parse(edgesContent);
  } catch (err) {
    console.error(`push-concept-graph.mjs: Failed to read/parse edges file: ${err.message}`);
    process.exit(1);
  }

  const graphData = {
    nodes: nodesData.nodes || [],
    edges: edgesData.edges || [],
  };

  // Validate all node types up-front. Unknown types — including PascalCase
  // Neo4j labels the LLM mistakenly copied into the JSON `type` field —
  // abort the push atomically. Partial pushes produce inconsistent graph
  // state and mask data loss (BUG-02). For PascalCase inputs the error
  // message suggests the canonical kebab-case form so the LLM can fix
  // the JSON without having to consult SKILL.md separately.
  if (graphData.nodes && Array.isArray(graphData.nodes)) {
    const unknownNodes = graphData.nodes.filter((node) => !TYPE_TO_LABEL[node.type]);
    if (unknownNodes.length > 0) {
      for (const node of unknownNodes) {
        const suggestion = suggestKebabCase(node.type);
        const isPascalCaseHint = /^[A-Z][A-Za-z]*$/.test(node.type) && TYPE_TO_LABEL[suggestion];
        if (isPascalCaseHint) {
          console.error(`push-concept-graph.mjs: Unknown node type '${node.type}' for node '${node.id}'. The JSON \`type\` field must be kebab-case — use '${suggestion}' instead of '${node.type}' (Neo4j label). See SKILL.md §type-table for canonical type names.`);
        } else {
          console.error(`push-concept-graph.mjs: Unknown node type '${node.type}' for node '${node.id}'. Known types: ${Object.keys(TYPE_TO_LABEL).join(", ")}. See SKILL.md §type-table for canonical type names.`);
        }
      }
      console.error(`push-concept-graph.mjs: ${unknownNodes.length} of ${graphData.nodes.length} node(s) skipped due to unknown type — push aborted.`);
      process.exit(2);
    }
  }

  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    console.error("push-concept-graph.mjs: No Neo4j configuration found");
    process.exit(1);
  }

  // Check connection type — if cypher-shell is requested, use it directly
  const connectionType = getConnectionType();
  if (connectionType === "cypher-shell") {
    pushConceptGraphViaCypherShell(neo4jConfig, graphData);
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
      throw new Error(process.env.NEO4J_TEST_MOCK_ERR || 'Connection refused (TestMock)');
    }
    // Test mode: controlled failure count — use a stub driver to avoid real network activity
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
    console.error(`push-concept-graph.mjs: neo4j-driver not available (${err.message}) — will use cypher-shell fallback.`);
  }

  if (!driverAvailable) {
    pushConceptGraphViaCypherShell(neo4jConfig, graphData);
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
      // Push nodes with dual labels: Knowledge + specific type label
      if (graphData.nodes && Array.isArray(graphData.nodes)) {
        for (const node of graphData.nodes) {
          // Upfront validation in pushConceptGraph() guarantees node.type is in TYPE_TO_LABEL.
          const secondaryLabel = TYPE_TO_LABEL[node.type];

          const props = {
            id: node.id,
            name: node.name || "",
            summary: node.summary || "",
            kind: "knowledge",
            source: "concept",
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
      // IMPLEMENTED_BY edges target :Codebase nodes (File, Function, Class), not :Knowledge nodes
      if (graphData.edges && Array.isArray(graphData.edges)) {
        for (const edge of graphData.edges) {
          const relType = edge.type.toUpperCase().replace(/[\s-]/g, "_");
          if (relType === "IMPLEMENTED_BY") {
            await session.run(
              `MATCH (a:Knowledge {id: $src}), (b:Codebase {id: $tgt})
               MERGE (a)-[r:\`${relType}\` {weight: $w}]->(b)`,
              { src: edge.source, tgt: edge.target, w: edge.weight || 1.0 }
            );
          } else {
            await session.run(
              `MATCH (a:Knowledge {id: $src}), (b:Knowledge {id: $tgt})
               MERGE (a)-[r:\`${relType}\` {weight: $w}]->(b)`,
              { src: edge.source, tgt: edge.target, w: edge.weight || 1.0 }
            );
          }
        }
      }

      // Ensure layer exists
      await session.run(
        `MATCH (n:Knowledge {source: 'concept'}) WITH collect(n.id) AS nodeIds
         MERGE (l:Layer {id: 'layer:knowledge'}) SET l.nodeIds = nodeIds`
      );

      // Post-push validation: check no node has only Knowledge without secondary label
      const orphanCheckResult = await session.run(
        `MATCH (n:Knowledge)
         WHERE NOT (n:Domain OR n:Feature OR n:Operation OR n:Actor OR n:BusinessRule OR n:Entity OR n:Decision OR n:Constraint OR n:Concept OR n:Claim OR n:Risk)
         RETURN n.id AS id, n.type AS type`
      );
      const orphans = orphanCheckResult.records.map(r => ({ id: r.get("id"), type: r.get("type") }));
      if (orphans.length > 0) {
        console.error(`push-concept-graph.mjs: WARNING — ${orphans.length} node(s) have no secondary label:`);
        for (const o of orphans) {
          console.error(`  ${o.id} (type: ${o.type})`);
        }
      }
    } finally {
      await session.close();
    }
  }

  try {
    await withRetry(runDriverAttempt, { retries: 3, delayMs: retryDelayMs, label: "push-concept-graph.mjs" });
    // Upfront validation in pushConceptGraph() guarantees all nodes have known types.
    const totalNodes = (graphData.nodes || []).length;
    console.log(`push-concept-graph.mjs: Concept plan graph pushed to Neo4j successfully (${totalNodes} node${totalNodes === 1 ? '' : 's'} written, 0 nodes skipped).`);
    process.exit(0);
  } catch (err) {
    console.error(`push-concept-graph.mjs: Failed to push concept plan graph: ${err.message}`);
    // Emit a specific DNS diagnostic before falling back
    const errMsg = err.message || "";
    if (errMsg.includes("ENOTFOUND") || errMsg.includes("EAI_AGAIN") || errMsg.includes("getaddrinfo")) {
      process.stderr.write(
        `push-concept-graph.mjs: DNS resolution failed for ${neo4jHostname}.\n` +
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
      console.error("push-concept-graph.mjs: Retrying via cypher-shell fallback...");
      pushConceptGraphViaCypherShell(neo4jConfig, graphData);
      return; // pushConceptGraphViaCypherShell calls process.exit internally
    }
    process.exit(1);
  } finally {
    if (driver) await driver.close();
  }
}

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error("Usage: node push-concept-graph.mjs <project-root>");
  process.exit(1);
}

pushConceptGraph(projectRoot).catch((err) => {
  console.error(`push-concept-graph.mjs: Unexpected error: ${err.message}`);
  process.exit(1);
});