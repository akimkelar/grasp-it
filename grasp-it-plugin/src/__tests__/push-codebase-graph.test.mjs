import { describe, it, expect } from "vitest";
import { toRelType, buildEdgesCypher } from "../../skills/grasp/push-codebase-graph.mjs";

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
