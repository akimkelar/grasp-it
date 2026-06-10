import { describe, it, expect, vi } from "vitest";
import { saveDomainGraphToNeo4j } from "../persistence/index.js";
import type { KnowledgeGraph } from "../types.js";

// Helper to create a minimal project meta
const makeProjectMeta = () => ({
  name: "Test Project",
  languages: ["TypeScript"],
  frameworks: [],
  description: "A test project",
  analyzedAt: "2024-01-01T00:00:00.000Z",
  gitCommitHash: "abc123def456",
});

// Helper to create a domain node
const makeDomainNode = (overrides: Partial<{
  id: string;
  name: string;
  type: string;
  summary: string;
  source: string | undefined;
  filePath: string | undefined;
  lineRange: [number, number] | undefined;
  tags: string[];
  complexity: string;
}> = {}) => ({
  id: "domain:test",
  name: "Test Domain",
  type: "domain",
  summary: "A test domain",
  filePath: undefined,
  lineRange: undefined,
  tags: [] as string[],
  complexity: "simple" as const,
  ...overrides,
});

// Helper to create a KnowledgeGraph with domain nodes
const makeDomainGraph = (nodes: ReturnType<typeof makeDomainNode>[]) => ({
  version: "1.0.0",
  kind: "knowledge" as const,
  project: makeProjectMeta(),
  nodes,
  edges: [],
  layers: [],
  tour: [],
});

// ─────────────────────────────────────────────────────────────────
// saveDomainGraphToNeo4j
// ─────────────────────────────────────────────────────────────────

describe("saveDomainGraphToNeo4j", () => {
  it("writes domain nodes with dual-label pattern Knowledge:SecondaryLabel", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "domain:orders", name: "Orders", type: "domain" })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    // First call clears existing domain elements
    const clearCall = mockSession.run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(clearCall[0]).toContain("MATCH (d:Knowledge)-[:PART_OF]->(p:Project {id: $projectId})");

    // Second call creates the domain node with dual-label pattern
    const createCall = mockSession.run.mock.calls[1] as unknown as [string, Record<string, unknown>];
    expect(createCall[0]).toContain("Knowledge:Domain");
  });

  it("passes 'type' property (not 'nodeType') in the query parameters", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "feature:auth", name: "Auth", type: "feature" })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    const createCall = mockSession.run.mock.calls[1] as unknown as [string, Record<string, unknown>];
    const params = createCall[1]!;

    // Verify 'type' is in the params, not 'nodeType'
    expect(params).toHaveProperty("type");
    expect(params.type).toBe("feature");
    expect(params).not.toHaveProperty("nodeType");
  });

  it("writes all domain nodes with kind: 'knowledge' in the query", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([
      makeDomainNode({ id: "domain:orders", name: "Orders", type: "domain" }),
      makeDomainNode({ id: "feature:auth", name: "Auth", type: "feature" }),
    ]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    // Check that the CREATE query contains kind: "knowledge"
    const createCall = mockSession.run.mock.calls[1] as unknown as [string, Record<string, unknown>];
    expect(createCall[0]).toContain('kind: "knowledge"');
  });

  it("handles all 6 domain node types: domain, feature, operation, actor, entity, business-rule", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const domainTypes = ["domain", "feature", "operation", "actor", "entity", "business-rule"] as const;
    const nodes = domainTypes.map((type, i) =>
      makeDomainNode({ id: `${type}:item${i}`, name: `${type.charAt(0).toUpperCase() + type.slice(1)} Item`, type })
    );

    const graph = makeDomainGraph(nodes);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    // Verify all 6 domain nodes were created + 1 clear + 1 project update = 8 calls total
    expect(mockSession.run).toHaveBeenCalledTimes(8);

    // Verify each node type gets the correct dual-label (skip index 0 = clear, last index = project update)
    const expectedLabels = ["Knowledge:Domain", "Knowledge:Feature", "Knowledge:Operation", "Knowledge:Actor", "Knowledge:Entity", "Knowledge:BusinessRule"];

    for (let i = 0; i < domainTypes.length; i++) {
      const createCall = mockSession.run.mock.calls[i + 1] as unknown as [string, Record<string, unknown>]; // +1 to skip the clear call
      expect(createCall[0]).toContain(expectedLabels[i]);
    }
  });

  it("defaults source to 'code-analysis' when not specified", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "domain:test", name: "Test", type: "domain", source: undefined })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    const createCall = mockSession.run.mock.calls[1] as unknown as [string, Record<string, unknown>];
    const params = createCall[1]!;

    expect(params.source).toBe("code-analysis");
  });

  it("uses explicit source value when provided", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "domain:test", name: "Test", type: "domain", source: "interview" })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    const createCall = mockSession.run.mock.calls[1] as unknown as [string, Record<string, unknown>];
    const params = createCall[1]!;

    expect(params.source).toBe("interview");
  });

  it("updates Project singleton with domainAnalyzedAt and domainCommit", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "domain:test", name: "Test", type: "domain" })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    // Last call should be the Project update
    const updateCall = mockSession.run.mock.calls[mockSession.run.mock.calls.length - 1] as unknown as [string, Record<string, unknown>];
    expect(updateCall[0]).toContain("domainAnalyzedAt");
    expect(updateCall[0]).toContain("domainCommit");

    const params = updateCall[1]!;
    expect(params).toHaveProperty("domainAnalyzedAt");
    expect(params).toHaveProperty("domainCommit");
    // domainCommit should come from graph.project.gitCommitHash when not explicitly passed
    expect(params.domainCommit).toBe("abc123def456");
  });

  it("uses explicit commit parameter when provided", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "domain:test", name: "Test", type: "domain" })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph, "project:singleton", "explicit-commit-hash");

    const updateCall = mockSession.run.mock.calls[mockSession.run.mock.calls.length - 1] as unknown as [string, Record<string, unknown>];
    const params = updateCall[1]!;

    expect(params.domainCommit).toBe("explicit-commit-hash");
  });

  it("clears existing domain elements before writing new ones", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({ id: "domain:test", name: "Test", type: "domain" })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    // First call should be the DELETE query
    const clearCall = mockSession.run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(clearCall[0]).toContain("DELETE d");
  });

  it("writes correct properties for domain nodes (id, name, type, summary, source, filePath, lineRange, tags, complexity)", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graph = makeDomainGraph([makeDomainNode({
      id: "domain:orders",
      name: "Orders Domain",
      type: "domain",
      summary: "Manages order lifecycle",
      source: "code-analysis",
      filePath: "src/domain/orders.ts",
      lineRange: [10, 50] as [number, number],
      tags: ["core", "ddd"],
      complexity: "complex",
    })]);

    await saveDomainGraphToNeo4j(mockSession as never, graph as KnowledgeGraph);

    const createCall = mockSession.run.mock.calls[1] as unknown as [string, Record<string, unknown>];
    const params = createCall[1]!;

    expect(params.id).toBe("domain:orders");
    expect(params.name).toBe("Orders Domain");
    expect(params.type).toBe("domain");
    expect(params.summary).toBe("Manages order lifecycle");
    expect(params.source).toBe("code-analysis");
    expect(params.filePath).toBe("src/domain/orders.ts");
    expect(params.lineRange).toEqual([10, 50]);
    expect(params.tags).toEqual(["core", "ddd"]);
    expect(params.complexity).toBe("complex");
  });
});