import { describe, it, expect, vi } from "vitest";
import { loadDomainGraphFromNeo4j } from "../persistence/index.js";

// ─────────────────────────────────────────────────────────────────
// loadDomainGraphFromNeo4j
// ─────────────────────────────────────────────────────────────────

describe("loadDomainGraphFromNeo4j", () => {
  it("returns null when no DomainElement nodes exist", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).toBeNull();
  });

  it("returns KnowledgeGraph with domain nodes when records exist", async () => {
    const mockRecord = {
      id: "domain:orders",
      name: "Orders",
      summary: "Order management domain",
      nodeType: "domain",
      source: "code-analysis",
      filePath: "src/orders.ts",
      lineRange: [1, 50],
      tags: ["core", "domain"],
      complexity: "complex",
      labels: ["DomainElement", "Domain"],
    };

    const mockSession = {
      run: vi.fn(async () => ({ records: [mockRecord] })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(result!.nodes[0].id).toBe("domain:orders");
    expect(result!.nodes[0].name).toBe("Orders");
    expect(result!.nodes[0].type).toBe("domain");
  });

  it("maps all domain element types correctly", async () => {
    const records = [
      { id: "domain:core", name: "Core", summary: "", nodeType: "domain", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "Domain"] },
      { id: "feature:auth", name: "Auth", summary: "", nodeType: "feature", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "Feature"] },
      { id: "operation:login", name: "Login", summary: "", nodeType: "operation", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "Operation"] },
      { id: "actor:user", name: "User", summary: "", nodeType: "actor", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "Actor"] },
      { id: "entity:order", name: "Order", summary: "", nodeType: "entity", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "Entity"] },
      { id: "business-rule:refund", name: "Refund Policy", summary: "", nodeType: "business-rule", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "BusinessRule"] },
    ];

    const mockSession = {
      run: vi.fn(async () => ({ records })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(6);
    expect(result!.nodes.map((n) => n.type)).toEqual(["domain", "feature", "operation", "actor", "entity", "business-rule"]);
  });

  it("returns empty edges, layers, and tour arrays", async () => {
    const mockRecord = {
      id: "domain:test",
      name: "Test Domain",
      summary: "Test domain element",
      nodeType: "domain",
      source: "code-analysis",
      filePath: "src/test.ts",
      lineRange: [1, 20],
      tags: ["test"],
      complexity: "simple",
      labels: ["DomainElement", "Domain"],
    };

    const mockSession = {
      run: vi.fn(async () => ({ records: [mockRecord] })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.edges).toEqual([]);
    expect(result!.layers).toEqual([]);
    expect(result!.tour).toEqual([]);
  });

  it("uses domain as default type when secondary label is unrecognized", async () => {
    const mockRecord = {
      id: "custom:type",
      name: "Custom",
      summary: "Custom element",
      nodeType: "domain",
      source: null,
      filePath: null,
      lineRange: null,
      tags: [],
      complexity: "simple",
      labels: ["DomainElement", "CustomLabel"],
    };

    const mockSession = {
      run: vi.fn(async () => ({ records: [mockRecord] })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes[0].type).toBe("domain");
  });
});