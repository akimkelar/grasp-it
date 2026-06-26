#!/usr/bin/env node
/**
 * push-domain-graph.mjs
 *
 * Reads domain-analysis.json from .grasp-it/intermediate/ and pushes it to Neo4j
 * using the Knowledge + specific label pattern.
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
import { execFileSync } from "child_process";
import { getNeo4jConfig, getConnectionType } from "../../skills/grasp/neo4j-config-loader.mjs";

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
  risk: "Risk",
  constraint: "Constraint",
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
  // Escape backslashes first, then single quotes
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
      if (node.severity) props.severity = node.severity;
      if (node.probability) props.probability = node.probability;
      if (node.mitigation) props.mitigation = node.mitigation;
      if (node.condition) props.condition = node.condition;
      if (node.invariant) props.invariant = node.invariant;
      if (node.sourceFiles) props.sourceFiles = node.sourceFiles;
      props.generatedAt = node.generatedAt || new Date().toISOString();
      if (node.sourceCommit) props.sourceCommit = node.sourceCommit;

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
 * IMPLEMENTED_BY edges target :Codebase nodes, not :Knowledge nodes.
 */
function buildEdgesCypher(graphData) {
  const lines = [];
  if (graphData.edges && Array.isArray(graphData.edges)) {
    for (const edge of graphData.edges) {
      const relType = edge.type.toUpperCase().replace(/-/g, "_");
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
 * Push domain graph using cypher-shell (fallback when driver is unavailable).
 */
function pushDomainGraphViaCypherShell(neo4jConfig, graphData) {
  // Push nodes
  const nodesCypher = buildNodesCypher(graphData, neo4jConfig);
  if (nodesCypher) {
    const result = runCypherShell(neo4jConfig, nodesCypher);
    if (!result.ok) {
      console.error(`push-domain-graph.mjs: cypher-shell node push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Push edges
  const edgesCypher = buildEdgesCypher(graphData);
  if (edgesCypher) {
    const result = runCypherShell(neo4jConfig, edgesCypher);
    if (!result.ok) {
      console.error(`push-domain-graph.mjs: cypher-shell edge push failed: ${result.reason}`);
      process.exit(1);
    }
  }

  // Per-Domain staleness: stamp each Domain node with analyzedAtCommit /
  // analyzedAt so the next Phase 2 staleness check can do a per-Domain
  // comparison. Replaces the legacy Project.domainCommit /
  // Project.domainAnalyzedAt global stamp.
  const currentCommit = graphData.project?.gitCommitHash || "";
  // Collect Domain node IDs from the assembled graph and inline them into the
  // cypher-shell query (runCypherShell takes a single string via stdin — no
  // parameter substitution).
  const domainIds = (graphData.nodes || [])
    .filter((n) => (n.type === "domain" || n.id?.startsWith("domain:")))
    .map((n) => n.id);
  if (domainIds.length > 0) {
    const domainIdList = domainIds.map((id) => cypherEscape(id)).join(", ");
    const domainUpdateCypher = `UNWIND [${domainIdList}] AS did MATCH (d:Domain {id: did}) SET d.analyzedAtCommit = ${cypherEscape(currentCommit)}, d.analyzedAt = datetime();`;
    runCypherShell(neo4jConfig, domainUpdateCypher); // best-effort
  }

  // Orphan check via cypher-shell (best-effort — don't exit on failure)
  const orphanQuery = `MATCH (n:Knowledge) WHERE NOT (n:Domain OR n:Feature OR n:Operation OR n:Actor OR n:Entity OR n:BusinessRule OR n:Risk OR n:Constraint) RETURN n.id AS id, n.type AS type;`;
  const orphanResult = runCypherShell(neo4jConfig, orphanQuery);
  if (!orphanResult.ok) {
    if (orphanResult.reason && orphanResult.reason.includes("cypher-shell not found")) {
      console.error(`push-domain-graph.mjs: WARNING — orphan check skipped: ${orphanResult.reason}`);
    }
    // Other errors are silently ignored — orphan check is best-effort
  }

  console.log("push-domain-graph.mjs: Domain graph pushed to Neo4j via cypher-shell successfully.");
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
async function withRetry(fn, { retries = 3, delayMs = 2000, label = "push-domain-graph.mjs" } = {}) {
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
      const derivedType = node.type || (node.id ? node.id.split(":")[0] : null);
      if (!TYPE_TO_LABEL[derivedType]) {
        console.error(`push-domain-graph.mjs: Unknown node type '${derivedType}' for node '${node.id}'. Known types: ${Object.keys(TYPE_TO_LABEL).join(", ")}`);
        process.exit(1);
      }
    }
  }

  const neo4jConfig = getNeo4jConfig(projectRoot);
  if (!neo4jConfig) {
    console.error("push-domain-graph.mjs: No Neo4j configuration found");
    process.exit(1);
  }

  // Check connection type — if cypher-shell is requested, use it directly
  const connectionType = getConnectionType();
  if (connectionType === "cypher-shell") {
    pushDomainGraphViaCypherShell(neo4jConfig, graphData);
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
    console.error(`push-domain-graph.mjs: neo4j-driver not available (${err.message}) — will use cypher-shell fallback.`);
  }

  if (!driverAvailable) {
    pushDomainGraphViaCypherShell(neo4jConfig, graphData);
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
            source: "code-analysis",
            type: node.type,
            tags: node.tags || [],
          };
          if (node.complexity) props.complexity = node.complexity;
          if (node.status) props.status = node.status;
          if (node.severity) props.severity = node.severity;
          if (node.probability) props.probability = node.probability;
          if (node.mitigation) props.mitigation = node.mitigation;
          if (node.condition) props.condition = node.condition;
          if (node.invariant) props.invariant = node.invariant;
          props.generatedAt = node.generatedAt || new Date().toISOString();
          if (node.sourceCommit) props.sourceCommit = node.sourceCommit;

          // Dual-label pattern: MERGE Knowledge base label, then add secondary label
          // Using backtick escaping for the secondary label which may contain special chars
          await session.run(
            `MERGE (n:Knowledge {id: $id}) SET n += $props SET n:\`${secondaryLabel}\``,
            { id: node.id, props }
          );
        }
      }

      // Push edges with correct relationship type
      // IMPLEMENTED_BY edges target :Codebase nodes (File, Function, Class), not :Knowledge nodes
      if (graphData.edges && Array.isArray(graphData.edges)) {
        for (const edge of graphData.edges) {
          const relType = edge.type.toUpperCase().replace(/-/g, "_");
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

      // Per-Domain staleness: stamp each Domain node with analyzedAtCommit /
      // analyzedAt. Replaces the legacy Project.domainCommit /
      // Project.domainAnalyzedAt global stamp (the Project singleton is now
      // a structural anchor only — Task F).
      const currentCommit = graphData.project?.gitCommitHash || "";
      const domainIds = (graphData.nodes || [])
        .filter((n) => (n.type === "domain" || n.id?.startsWith("domain:")))
        .map((n) => n.id);
      if (domainIds.length > 0) {
        await session.run(
          `UNWIND $domainIds AS did
           MATCH (d:Domain {id: did})
           SET d.analyzedAtCommit = $commit, d.analyzedAt = datetime()`,
          { domainIds, commit: currentCommit }
        );
      }
    } finally {
      await session.close();
    }

    // Post-push validation: check no node has only Knowledge without secondary label
    const orphanCheck = await driver.session({ database: neo4jConfig.NEO4J_DATABASE || "grasp" }).run(
      `MATCH (n:Knowledge)
       WHERE NOT (n:Domain OR n:Feature OR n:Operation OR n:Actor OR n:Entity OR n:BusinessRule OR n:Risk OR n:Constraint)
       RETURN n.id AS id, n.type AS type`
    );
    const orphans = orphanCheck.records.map(r => ({ id: r.get("id"), type: r.get("type") }));
    if (orphans.length > 0) {
      console.error(`push-domain-graph.mjs: WARNING — ${orphans.length} node(s) have no secondary label:`);
      for (const o of orphans) {
        console.error(`  ${o.id} (type: ${o.type})`);
      }
    }
  }

  try {
    await withRetry(runDriverAttempt, { retries: 3, delayMs: retryDelayMs, label: "push-domain-graph.mjs" });
    console.log("push-domain-graph.mjs: Domain graph pushed to Neo4j successfully.");
    process.exit(0);
  } catch (err) {
    console.error(`push-domain-graph.mjs: Failed to push domain graph: ${err.message}`);
    // Emit a specific DNS diagnostic before falling back
    const errMsg = err.message || "";
    if (errMsg.includes("ENOTFOUND") || errMsg.includes("EAI_AGAIN") || errMsg.includes("getaddrinfo")) {
      process.stderr.write(
        `push-domain-graph.mjs: DNS resolution failed for ${neo4jHostname}.\n` +
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
      console.error("push-domain-graph.mjs: Retrying via cypher-shell fallback...");
      pushDomainGraphViaCypherShell(neo4jConfig, graphData);
    }
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