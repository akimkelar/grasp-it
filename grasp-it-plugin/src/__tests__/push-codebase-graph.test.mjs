import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  toRelType,
  buildEdgesCypher,
  CYPHER_SHELL_TIMEOUT_MS,
} from "../../skills/grasp/push-codebase-graph.mjs";

const __dirname_test = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH_test = resolve(__dirname_test, "../../skills/grasp/push-codebase-graph.mjs");

function runPushCodebaseGraph_test(projectRoot, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return spawnSync("node", [SCRIPT_PATH_test, projectRoot], {
    encoding: "utf-8",
    env,
    timeout: 30_000,
  });
}

// ── toRelType ──────────────────────────────────────────────────────────────────

describe("toRelType", () => {
  describe("structural edge types", () => {
    it('converts "contains" → "CONTAINS"', () => expect(toRelType("contains")).toBe("CONTAINS"));
    it('converts "imports" → "IMPORTS"', () => expect(toRelType("imports")).toBe("IMPORTS"));
    it('converts "exports" → "EXPORTS"', () => expect(toRelType("exports")).toBe("EXPORTS"));
    it('converts "inherits" → "INHERITS"', () => expect(toRelType("inherits")).toBe("INHERITS"));
    it('converts "implements" → "IMPLEMENTS"', () => expect(toRelType("implements")).toBe("IMPLEMENTS"));
  });

  describe("behavioral edge types", () => {
    it('converts "calls" → "CALLS"', () => expect(toRelType("calls")).toBe("CALLS"));
    it('converts "exposes" → "EXPOSES"', () => expect(toRelType("exposes")).toBe("EXPOSES"));
    it('converts "reads_from" → "READS_FROM"', () => expect(toRelType("reads_from")).toBe("READS_FROM"));
    it('converts "writes_to" → "WRITES_TO"', () => expect(toRelType("writes_to")).toBe("WRITES_TO"));
    it('converts "transforms" → "TRANSFORMS"', () => expect(toRelType("transforms")).toBe("TRANSFORMS"));
    it('converts "validates" → "VALIDATES"', () => expect(toRelType("validates")).toBe("VALIDATES"));
    it('converts "subscribes" → "SUBSCRIBES"', () => expect(toRelType("subscribes")).toBe("SUBSCRIBES"));
    it('converts "publishes" → "PUBLISHES"', () => expect(toRelType("publishes")).toBe("PUBLISHES"));
    it('converts "middleware" → "MIDDLEWARE"', () => expect(toRelType("middleware")).toBe("MIDDLEWARE"));
  });

  describe("dependency edge types", () => {
    it('converts "depends_on" → "DEPENDS_ON"', () => expect(toRelType("depends_on")).toBe("DEPENDS_ON"));
    it('converts "tested_by" → "TESTED_BY"', () => expect(toRelType("tested_by")).toBe("TESTED_BY"));
    it('converts "configures" → "CONFIGURES"', () => expect(toRelType("configures")).toBe("CONFIGURES"));
  });

  describe("semantic edge types", () => {
    it('converts "related" → "RELATED"', () => expect(toRelType("related")).toBe("RELATED"));
    it('converts "similar_to" → "SIMILAR_TO"', () => expect(toRelType("similar_to")).toBe("SIMILAR_TO"));
  });

  describe("infrastructure edge types", () => {
    it('converts "deploys" → "DEPLOYS"', () => expect(toRelType("deploys")).toBe("DEPLOYS"));
    it('converts "serves" → "SERVES"', () => expect(toRelType("serves")).toBe("SERVES"));
    it('converts "provisions" → "PROVISIONS"', () => expect(toRelType("provisions")).toBe("PROVISIONS"));
    it('converts "triggers" → "TRIGGERS"', () => expect(toRelType("triggers")).toBe("TRIGGERS"));
  });

  describe("schema/data edge types", () => {
    it('converts "migrates" → "MIGRATES"', () => expect(toRelType("migrates")).toBe("MIGRATES"));
    it('converts "documents" → "DOCUMENTS"', () => expect(toRelType("documents")).toBe("DOCUMENTS"));
    it('converts "routes" → "ROUTES"', () => expect(toRelType("routes")).toBe("ROUTES"));
    it('converts "defines_schema" → "DEFINES_SCHEMA"', () => expect(toRelType("defines_schema")).toBe("DEFINES_SCHEMA"));
  });

  describe("edge cases", () => {
    it("returns RELATED for undefined", () => expect(toRelType(undefined)).toBe("RELATED"));
    it("returns RELATED for null", () => expect(toRelType(null)).toBe("RELATED"));
    it("returns RELATED for empty string", () => expect(toRelType("")).toBe("RELATED"));
    it("is idempotent — already-uppercase input passes through", () =>
      expect(toRelType("CONTAINS")).toBe("CONTAINS"));
    it("replaces hyphens with underscores", () =>
      expect(toRelType("defines-schema")).toBe("DEFINES_SCHEMA"));
    it("handles mixed case with underscores", () =>
      expect(toRelType("Reads_From")).toBe("READS_FROM"));
  });
});

// ── buildEdgesCypher ───────────────────────────────────────────────────────────

describe("buildEdgesCypher", () => {
  it("uses named relationship type, not :RELATES", () => {
    const graphData = {
      edges: [
        { source: "node:a", target: "node:b", type: "contains", direction: "outgoing" },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    expect(cypher).toContain("`CONTAINS`");
    expect(cypher).not.toContain(":RELATES");
  });

  it("generates correct Cypher for defines_schema edge", () => {
    const graphData = {
      edges: [
        { source: "node:x", target: "node:y", type: "defines_schema", direction: "outgoing" },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    expect(cypher).toContain("`DEFINES_SCHEMA`");
    expect(cypher).not.toContain(":RELATES");
  });

  it("generates correct Cypher for exposes edge (Endpoint → Function)", () => {
    const graphData = {
      edges: [
        {
          source: "endpoint:api/routes.ts:POST-/users",
          target: "function:src/handlers/users.ts:createUser",
          type: "exposes",
          direction: "outgoing",
        },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    expect(cypher).toContain("`EXPOSES`");
    expect(cypher).not.toContain("CALLS");
    expect(cypher).not.toContain("RELATES");
  });

  it("uses RELATED as fallback when type is missing", () => {
    const graphData = {
      edges: [
        { source: "node:a", target: "node:b", direction: "outgoing" },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    expect(cypher).toContain("`RELATED`");
  });

  it("does not include 'type' as a property in the SET clause", () => {
    const graphData = {
      edges: [
        { source: "node:a", target: "node:b", type: "calls", direction: "outgoing" },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    // The relationship type is encoded in the rel pattern, not as a property
    // SET should only set direction, weight (and optionally description) — not type
    const setClause = cypher.match(/SET r \+= \{([^}]+)\}/)?.[1] ?? "";
    expect(setClause).not.toMatch(/\btype\b/);
  });

  it("includes direction and weight in SET clause", () => {
    const graphData = {
      edges: [
        { source: "node:a", target: "node:b", type: "imports", direction: "outgoing", weight: 0.8 },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    expect(cypher).toContain("direction:");
    expect(cypher).toContain("weight:");
  });

  it("includes description when provided", () => {
    const graphData = {
      edges: [
        {
          source: "node:a",
          target: "node:b",
          type: "depends_on",
          direction: "outgoing",
          description: "runtime dependency",
        },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    expect(cypher).toContain("description:");
    expect(cypher).toContain("runtime dependency");
  });

  it("returns empty string when no edges", () => {
    expect(buildEdgesCypher({ edges: [] })).toBe("");
    expect(buildEdgesCypher({})).toBe("");
  });

  it("generates one MERGE statement per edge", () => {
    const graphData = {
      edges: [
        { source: "a", target: "b", type: "calls", direction: "outgoing" },
        { source: "b", target: "c", type: "imports", direction: "outgoing" },
      ],
    };
    const cypher = buildEdgesCypher(graphData);
    const mergeCount = (cypher.match(/MERGE/g) || []).length;
    expect(mergeCount).toBe(2);
  });
});

// ── cypher-shell timeout configuration ────────────────────────────────────────
//
// Bulk pushes send ALL nodes + edges as a single cypher-shell invocation. For
// 200+ statements against a remote Neo4j, the cypher-shell child process runs
// for 10-30s. A 10s execFileSync timeout kills the child mid-transaction and
// the push fails with no useful error. The push script must use a timeout
// large enough to let a real bulk push complete.

describe("CYPHER_SHELL_TIMEOUT_MS", () => {
  it("is exported and is a positive number", () => {
    expect(typeof CYPHER_SHELL_TIMEOUT_MS).toBe("number");
    expect(CYPHER_SHELL_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("is large enough for a bulk push of hundreds of statements (>= 60s)", () => {
    // A push of ~280 statements (107 nodes + 175 edges) takes 10-30s against
    // a remote Neo4j. We need headroom for larger projects and slower links.
    expect(CYPHER_SHELL_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("is not the legacy 10s value", () => {
    // Guard against accidental revert. If this fires, the push script will
    // time out on any non-trivial graph against a remote database.
    expect(CYPHER_SHELL_TIMEOUT_MS).not.toBe(10_000);
  });
});

// ── BUG-02: buildNodesCypher — TYPE_TO_LABEL coverage ──────────────────────
//
// BUG-02 was a schema-truth mismatch: SKILL.md Reference listed `concept` as
// a Codebase node type, but `concept` is actually a Knowledge node (handled by
// push-concept-graph.mjs). push-codebase-graph.mjs's TYPE_TO_LABEL map
// correctly omits `concept`, so `concept` nodes are silently dropped. These
// regression tests pin that behavior down so future code changes cannot
// silently reintroduce the schema mismatch.
//
// The 12 codebase types listed in TYPE_TO_LABEL (file, function, class,
// module, config, document, service, table, endpoint, pipeline, schema,
// resource) must each produce a MERGE line. Knowledge-only types
// (concept, domain, feature, operation, actor, business-rule, entity, risk,
// constraint, decision, claim) must NOT produce any MERGE.
//
// buildNodesCypher is not exported, so we invoke the push script as a
// subprocess and capture the generated Cypher query via a mock cypher-shell
// that echoes its stdin to stderr.

describe("buildNodesCypher — TYPE_TO_LABEL coverage (BUG-02 regression)", () => {
  let root;
  let mockDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "push-cbg-bug02-"));
    mkdirSync(join(root, ".grasp-it", "intermediate"), { recursive: true });

    // Mock cypher-shell that echoes stdin (the Cypher query) to stderr so
    // tests can inspect the generated query. exit 0 so multi-call flows
    // (nodes → edges → layers) accumulate their echoes.
    mockDir = mkdtempSync(join(tmpdir(), "mock-cypher-bug02-"));
    writeFileSync(
      join(mockDir, "cypher-shell"),
      `#!/bin/sh\ncat >&2\nexit 0\n`,
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
  });

  function writeGraph(nodes = [], edges = [], layers = []) {
    writeFileSync(
      join(root, ".grasp-it", "intermediate", "assembled-graph.json"),
      JSON.stringify({
        project: { gitCommitHash: "abc123" },
        version: "1.0.0",
        nodes,
        edges,
        layers,
      }),
    );
  }

  function push(graph, neo4jConfig = {}) {
    writeGraph(graph.nodes || [], graph.edges || [], graph.layers || []);
    return runPushCodebaseGraph_test(root, {
      NEO4J_URI: neo4jConfig.NEO4J_URI || "neo4j://localhost:7687",
      NEO4J_USERNAME: neo4jConfig.NEO4J_USERNAME || "neo4j",
      NEO4J_PASSWORD: neo4jConfig.NEO4J_PASSWORD || "password",
      NEO4J_DATABASE: neo4jConfig.NEO4J_DATABASE || "grasp",
      NEO4J_CONNECTION_TYPE: "cypher-shell",
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });
  }

  // The lowercase type → PascalCase label mapping that the push script
  // hard-codes in TYPE_TO_LABEL. Kept here as a single source of truth for
  // the sanity test below.
  const CODEBASE_TYPE_TO_LABEL = {
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

  describe("sanity: each of the 12 codebase types produces a MERGE line", () => {
    for (const [type, label] of Object.entries(CODEBASE_TYPE_TO_LABEL)) {
      it(`codebase type '${type}' is mapped to label \`${label}\` and produces a MERGE`, () => {
        const result = push({
          nodes: [
            { id: `${type}:foo`, name: "Foo", type, summary: "x", tags: [] },
          ],
        });

        // Stub cypher-shell echoes stdin to stderr; assert on the echoed query
        expect(result.stderr).toContain(`SET n:\`${label}\``);
        expect(result.stderr).toMatch(/MERGE \(n \{id: '[^']*'\}\)/);
      });
    }
  });

  describe("knowledge-only types are silently dropped (BUG-02 regression)", () => {
    const knowledgeTypes = [
      "concept",        // ← the original offender (BUG-02)
      "domain",
      "feature",
      "operation",
      "actor",
      "business-rule",
      "entity",
      "risk",
      "constraint",
      "decision",
      "claim",
    ];

    for (const type of knowledgeTypes) {
      it(`concept-class type '${type}' produces no MERGE line (silently skipped)`, () => {
        // Mirror the BUG-02 off-by-one: even when only knowledge nodes are
        // passed in, the push script must produce empty output for the node
        // push phase. No MERGE line should contain the node id.
        const result = push({
          nodes: [
            { id: `${type}:orphan-1`, name: "Orphan", type, summary: "s", tags: [] },
          ],
        });

        // No MERGE for the node — it must be silently skipped.
        expect(result.stderr).not.toMatch(/MERGE \(n \{id: 'orphan-1'\}\)/);
        // The orphan id should never appear in any MERGE at all
        expect(result.stderr).not.toContain("'orphan-1'");
      });
    }

    it("BUG-02 specifically: pushing only `concept` nodes produces no MERGE cypher", () => {
      // Direct pin-down of the BUG-02 case: a graph containing only `concept`
      // nodes must produce no MERGE cypher for those node ids. This guards
      // against someone re-adding `concept: "Concept"` to TYPE_TO_LABEL.
      const result = push({
        nodes: [
          { id: "concept:invoice-assignment", name: "Invoice Assignment", type: "concept", summary: "Specialist abstraction", tags: [] },
          { id: "concept:auth", name: "Auth", type: "concept", summary: "Another concept", tags: [] },
        ],
      });

      // No MERGE should be generated for either concept id
      expect(result.stderr).not.toContain("MERGE (n {id: 'concept:invoice-assignment'})");
      expect(result.stderr).not.toContain("MERGE (n {id: 'concept:auth'})");
      // The Concept label must not appear (no `SET n:\`Concept\``)
      expect(result.stderr).not.toContain("SET n:`Concept`");
    });
  });

  it("empty graph produces empty node cypher (only UPDATE statement on File nodes)", () => {
    // With no nodes, the only cypher emitted should be the trailing
    // `MATCH (f:File) SET f.analyzedAtCommit = ... UPDATE` plus the
    // `MATCH (f:File) SET f.analyzedAt = ...` best-effort calls.
    // There must be NO MERGE for any node or edge.
    const result = push({ nodes: [], edges: [] });

    expect(result.stderr).not.toContain("MERGE (n");
    expect(result.stderr).not.toContain("MERGE (a)-[r");
    // Empty graph still emits the trailing File-stamp update — that is
    // the only cypher we expect.
    expect(result.stderr).toMatch(/MATCH \(f:File\) SET f\.(analyzedAtCommit|analyzedAt)/);
  });

  it("mixed graph: valid codebase types written, knowledge types dropped", () => {
    // One valid codebase node + one knowledge-only node. The valid one must
    // produce a MERGE, the knowledge one must be silently dropped.
    const result = push({
      nodes: [
        { id: "file:src/main.ts", name: "main.ts", type: "file", summary: "Entry", tags: [] },
        { id: "concept:auth", name: "Auth", type: "concept", summary: "Specialist concept", tags: [] },
      ],
    });

    // The file node must produce a MERGE with SET n:`File`
    expect(result.stderr).toContain("MERGE (n {id: 'file:src/main.ts'})");
    expect(result.stderr).toContain("SET n:`File`");
    // The concept node must NOT produce a MERGE
    expect(result.stderr).not.toContain("MERGE (n {id: 'concept:auth'})");
    expect(result.stderr).not.toContain("SET n:`Concept`");
  });
});
