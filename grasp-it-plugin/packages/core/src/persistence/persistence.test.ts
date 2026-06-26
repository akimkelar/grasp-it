import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveFingerprints, loadFingerprints, saveConfig, loadConfig,
  saveDomainGraphToNeo4j, loadDomainGraphFromNeo4j,
  saveGraphToNeo4j, loadGraphFromNeo4j,
} from "./index.js";
import type { KnowledgeGraph, GraphNode } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ua-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────
// saveFingerprints / loadFingerprints
// ─────────────────────────────────────────────────────────────────

describe("saveFingerprints / loadFingerprints", () => {
    const sampleFingerprints: FingerprintStore = {
      version: "1.0.0",
      gitCommitHash: "abc123",
      generatedAt: "2026-03-14T00:00:00.000Z",
      files: {
        "src/index.ts": {
          filePath: "src/index.ts",
          contentHash: "deadbeef",
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          totalLines: 10,
          hasStructuralAnalysis: false,
        },
      },
    };

    it("should round-trip fingerprints correctly", () => {
      saveFingerprints(tempDir, sampleFingerprints);
      const loaded = loadFingerprints(tempDir);

      expect(loaded).toEqual(sampleFingerprints);
    });

    it("should return null when no fingerprints file exists", () => {
      const loaded = loadFingerprints(tempDir);
      expect(loaded).toBeNull();
    });

    it("should return null when fingerprints.json is corrupted", () => {
      const dir = join(tempDir, ".grasp-it");
      // Ensure the directory exists by saving first, then overwrite with garbage
      saveFingerprints(tempDir, sampleFingerprints);
      writeFileSync(join(dir, "fingerprints.json"), "{{not valid json!!", "utf-8");

      const loaded = loadFingerprints(tempDir);
      expect(loaded).toBeNull();
    });
  });

  describe("saveConfig / loadConfig", () => {
    it("should round-trip config correctly", () => {
      saveConfig(tempDir, { autoUpdate: true });
      const loaded = loadConfig(tempDir);

      // saveConfig merges with defaults and any prior content, so the saved file
      // includes the default outputLanguage alongside autoUpdate.
      expect(loaded).toEqual({ autoUpdate: true, outputLanguage: "en" });
    });

    it("should return default config when no file exists", () => {
      const loaded = loadConfig(tempDir);

      expect(loaded).toEqual({ autoUpdate: false, outputLanguage: "en" });
    });

    it("should return default config when config.json is corrupted", () => {
      saveConfig(tempDir, { autoUpdate: true });
      const dir = join(tempDir, ".grasp-it");
      writeFileSync(join(dir, "config.json"), "not json!!", "utf-8");

      const loaded = loadConfig(tempDir);
      expect(loaded).toEqual({ autoUpdate: false, outputLanguage: "en" });
    });

    it("should preserve an explicit `version` field across save/load", () => {
      saveConfig(tempDir, { autoUpdate: true });
      saveConfig(tempDir, { version: "1.2.3" });
      const loaded = loadConfig(tempDir);
      // version is preserved because saveConfig merges with the existing content.
      expect(loaded.version).toBe("1.2.3");
      expect(loaded.autoUpdate).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────
// saveDomainGraphToNeo4j
// ─────────────────────────────────────────────────────────────────

describe("saveDomainGraphToNeo4j", () => {
  it("deletes existing Knowledge nodes before writing new ones", async () => {
    const sampleGraph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        {
          id: "domain:orders",
          type: "feature",
          name: "Orders Feature",
          summary: "Order management",
          tags: [],
          complexity: "moderate",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveDomainGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton", "abc123");

    // First call should be the DELETE query
    expect(calls[0]![0]).toContain("DELETE d");
    expect(calls[0]![1]).toEqual({ projectId: "project:singleton" });
  });

  it("writes one CREATE query per domain node with correct labels", async () => {
    const sampleGraph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        {
          id: "domain:orders",
          type: "domain",
          name: "Orders",
          summary: "Order domain",
          tags: ["core"],
          complexity: "complex",
        },
        {
          id: "feature:create-order",
          type: "feature",
          name: "Create Order",
          summary: "Create a new order",
          tags: [],
          complexity: "moderate",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveDomainGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton", "abc123");

    // Verify node CREATE calls (after the DELETE call at index 0)
    const nodeCalls = calls.slice(1, 3); // Two nodes → two CREATE calls

    expect(nodeCalls[0]![0]).toContain("CREATE (d:Knowledge:Domain");
    expect(nodeCalls[0]![1]).toMatchObject({ id: "domain:orders", name: "Orders" });

    expect(nodeCalls[1]![0]).toContain("CREATE (d:Knowledge:Feature");
    expect(nodeCalls[1]![1]).toMatchObject({ id: "feature:create-order", name: "Create Order" });
  });

  it("stamps Domain nodes with analyzedAtCommit per-Domain", async () => {
    const sampleGraph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        {
          id: "domain:orders",
          type: "domain",
          name: "Orders",
          summary: "Orders domain",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveDomainGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton", "def456");

    // Find the Domain CREATE call (carries the per-Domain stamps)
    const domainCall = calls.find(([q]) => q.includes("Knowledge:Domain"));
    expect(domainCall).toBeDefined();
    expect(domainCall![0]).toContain("analyzedAtCommit");
    expect(domainCall![0]).toContain("analyzedAt");
    expect(domainCall![1].analyzedAtCommit).toBe("def456");
  });

  it("uses graph.project.gitCommitHash as analyzedAtCommit when commit not provided", async () => {
    const sampleGraph: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        {
          id: "domain:orders",
          type: "domain",
          name: "Orders",
          summary: "Orders domain",
          tags: [],
          complexity: "simple",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveDomainGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    const domainCall = calls.find(([q]) => q.includes("Knowledge:Domain"));
    expect(domainCall).toBeDefined();
    expect(domainCall![1].analyzedAtCommit).toBe("abc123");
  });

  it("correctly sets kind = \"knowledge\" for domain nodes", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    const graphWithDomainNodes: KnowledgeGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: "abc123",
      },
      nodes: [
        {
          id: "domain:orders",
          type: "domain",
          name: "Orders",
          summary: "Order domain",
          tags: [],
          complexity: "complex",
        },
        {
          id: "feature:create-order",
          type: "feature",
          name: "Create Order",
          summary: "Create a new order",
          tags: [],
          complexity: "moderate",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    await saveDomainGraphToNeo4j(mockSession as never, graphWithDomainNodes, "project:singleton", "abc123");

    // Verify domain node CREATE calls include kind = "knowledge"
    const nodeCalls = calls.slice(1, 3); // After DELETE
    expect(nodeCalls[0]![0]).toContain("CREATE (d:Knowledge:Domain");
    expect(nodeCalls[0]![0]).toContain('kind: "knowledge"');

    expect(nodeCalls[1]![0]).toContain("CREATE (d:Knowledge:Feature");
    expect(nodeCalls[1]![0]).toContain('kind: "knowledge"');
  });

  it("throws on invalid node label", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graphWithBadNode = {
      version: "1.0.0",
      kind: "codebase",
      project: {
        name: "test",
        languages: [],
        frameworks: [],
        description: "",
        analyzedAt: "",
        gitCommitHash: "",
      },
      nodes: [
        {
          id: "bad-node",
          type: "unknown-type",
          name: "Bad Node",
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    await expect(
      saveDomainGraphToNeo4j(mockSession as never, graphWithBadNode as never, "project:singleton"),
    ).rejects.toThrow(/Invalid node label/);
  });

  it("throws on wrong kind for node type", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const graphWithWrongKind = {
      version: "1.0.0",
      kind: "codebase",
      project: {
        name: "test",
        languages: [],
        frameworks: [],
        description: "",
        analyzedAt: "",
        gitCommitHash: "",
      },
      nodes: [
        {
          id: "domain:test",
          type: "domain",
          name: "Test Domain",
          kind: "codebase", // Wrong - domain must be "knowledge"
        },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    await expect(
      saveDomainGraphToNeo4j(mockSession as never, graphWithWrongKind as never, "project:singleton"),
    ).rejects.toThrow(/must have kind = "knowledge"/);
  });
});

// ─────────────────────────────────────────────────────────────────
// loadDomainGraphFromNeo4j
// ─────────────────────────────────────────────────────────────────

describe("loadDomainGraphFromNeo4j", () => {
  it("returns null when no Knowledge nodes exist", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).toBeNull();
    expect(mockSession.run).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (d:Knowledge) WHERE d.projectId"),
      expect.objectContaining({ projectId: "project:singleton" }),
    );
  });

  it("returns KnowledgeGraph with nodes when Knowledge records exist", async () => {
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
      labels: ["Knowledge", "Domain"],
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
    expect(result!.nodes[0].filePath).toBe("src/orders.ts");
  });

  it("maps secondary label to correct node type", async () => {
    const records = [
      { id: "feature:auth", name: "Auth", summary: "", type: "feature", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["Knowledge", "Feature"] },
      { id: "operation:login", name: "Login", summary: "", type: "operation", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["Knowledge", "Operation"] },
      { id: "actor:user", name: "User", summary: "", type: "actor", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["Knowledge", "Actor"] },
      { id: "entity:order", name: "Order", summary: "", type: "entity", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["Knowledge", "Entity"] },
      { id: "business-rule:refund", name: "Refund Policy", summary: "", type: "business-rule", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["Knowledge", "BusinessRule"] },
    ];

    const mockSession = {
      run: vi.fn(async () => ({ records })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(5);
    expect(result!.nodes.map((n) => n.type)).toEqual(["feature", "operation", "actor", "entity", "business-rule"]);
  });

  it("uses domain as default type when secondary label is not recognized", async () => {
    const mockRecord = {
      id: "custom:type",
      name: "Custom",
      summary: "Custom domain element",
      nodeType: "domain",
      source: null,
      filePath: null,
      lineRange: null,
      tags: [],
      complexity: "simple",
      labels: ["Knowledge", "CustomType"],
    };

    const mockSession = {
      run: vi.fn(async () => ({ records: [mockRecord] })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes[0].type).toBe("domain");
  });

  it("returns empty edges, layers, and tour arrays", async () => {
    const mockSession = {
      run: vi.fn(async () => ({
        records: [{ id: "domain:test", name: "Test", summary: "", nodeType: "domain", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["Knowledge", "Domain"] }],
      })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result!.edges).toEqual([]);
    expect(result!.layers).toEqual([]);
    expect(result!.tour).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// saveGraphToNeo4j
// ─────────────────────────────────────────────────────────────────

describe("saveGraphToNeo4j", () => {
  const sampleGraph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: "test-project",
      languages: ["typescript"],
      frameworks: ["vitest"],
      description: "A test project",
      analyzedAt: "2026-03-14T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [
      {
        id: "node-1",
        type: "file",
        name: "index.ts",
        filePath: "src/index.ts",
        lineRange: [1, 50],
        summary: "Entry point",
        tags: ["entry"],
        complexity: "simple",
      },
    ],
    edges: [
      {
        source: "node-1",
        target: "node-1",
        type: "imports",
        direction: "forward",
        weight: 0.8,
      },
    ],
    layers: [
      {
        id: "layer-1",
        name: "Core",
        description: "Core layer",
        nodeIds: ["node-1"],
      },
    ],
    tour: [
      {
        order: 1,
        title: "Start here",
        description: "Begin with the entry point",
        nodeIds: ["node-1"],
      },
    ],
  };

  it("clears existing nodes and relationships before writing", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    // First two calls should be DELETE queries to clear existing data
    expect(calls[0]![0]).toContain("DELETE");
    expect(calls[1]![0]).toContain("DELETE");
  });

  it("does not MERGE a Project singleton (Task G removed it)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    // No MERGE :Project query should appear
    const projectCall = calls.find(([q]) => q.includes("MERGE (p:Project"));
    expect(projectCall).toBeUndefined();
  });

  it("does not create :PART_OF edges (Task G replaced them with projectId property)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    const partOfCall = calls.find(([q]) => q.includes("[:PART_OF]"));
    expect(partOfCall).toBeUndefined();
  });

  it("creates one Codebase:File node per file node in the graph", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    // Count CREATE calls for Codebase:File nodes (not Layer or TourStep)
    const nodeCalls = calls.filter(([q]) => q.includes("CREATE (n:Codebase:File"));
    expect(nodeCalls).toHaveLength(1);
    expect(nodeCalls[0]![1]).toMatchObject({ id: "node-1", name: "index.ts", projectId: "project:singleton" });
  });

  it("creates RELATES edge for each edge in the graph", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    const edgeCalls = calls.filter(([q]) => q.includes("CREATE (src)-[r:RELATES {"));
    expect(edgeCalls).toHaveLength(1);
    expect(edgeCalls[0]![1]).toMatchObject({
      edgeSource: "node-1",
      edgeTarget: "node-1",
      type: "imports",
    });
  });

  it("creates Layer nodes for each layer", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    const layerCalls = calls.filter(([q]) => q.includes("CREATE (l:Layer"));
    expect(layerCalls).toHaveLength(1);
    expect(layerCalls[0]![1]).toMatchObject({ id: "layer-1", name: "Core", projectId: "project:singleton" });
  });

  it("creates TourStep nodes for each tour step", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    await saveGraphToNeo4j(mockSession as never, sampleGraph, "project:singleton");

    const tourCalls = calls.filter(([q]) => q.includes("CREATE (t:TourStep"));
    expect(tourCalls).toHaveLength(1);
    expect(tourCalls[0]![1]).toMatchObject({ title: "Start here", order: 1 });
  });

  it("throws on invalid label", async () => {
    const mockSession = {
      run: async (_query: string, _params: Record<string, unknown>) => {
        return { records: [] };
      },
    };

    const graphWithInvalidLabel: KnowledgeGraph = {
      ...sampleGraph,
      nodes: [
        {
          id: "node-invalid",
          type: "codenode" as any,
          name: "Invalid Node",
          summary: "Test",
          tags: [],
          complexity: "simple",
        },
      ],
    };

    await expect(saveGraphToNeo4j(mockSession as never, graphWithInvalidLabel, "project:singleton")).rejects.toThrow(
      /Invalid node label/,
    );
  });

  it("throws on wrong kind for node type", async () => {
    const mockSession = {
      run: async (_query: string, _params: Record<string, unknown>) => {
        return { records: [] };
      },
    };

    const graphWithWrongKind: KnowledgeGraph = {
      ...sampleGraph,
      nodes: [
        {
          id: "node-wrong-kind",
          type: "file",
          name: "File Node",
          summary: "Test",
          tags: [],
          complexity: "simple",
          kind: "knowledge" as any,
        },
      ],
    };

    await expect(saveGraphToNeo4j(mockSession as never, graphWithWrongKind, "project:singleton")).rejects.toThrow(
      /must have kind = "codebase"/,
    );
  });

  it("correctly sets kind = \"codebase\" for File/Function/Class nodes", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const mockSession = {
      run: async (query: string, params: Record<string, unknown>) => {
        calls.push([query, params]);
        return { records: [] };
      },
    };

    const graphWithCodebaseNodes: KnowledgeGraph = {
      ...sampleGraph,
      nodes: [
        {
          id: "file-node",
          type: "file",
          name: "Test File",
          summary: "Test",
          tags: [],
          complexity: "simple",
        },
        {
          id: "function-node",
          type: "function",
          name: "Test Function",
          summary: "Test",
          tags: [],
          complexity: "simple",
        },
        {
          id: "class-node",
          type: "class",
          name: "Test Class",
          summary: "Test",
          tags: [],
          complexity: "simple",
        },
      ],
    };

    await saveGraphToNeo4j(mockSession as never, graphWithCodebaseNodes, "project:singleton");

    const nodeCalls = calls.filter(([q]) => q.includes("CREATE (n:"));
    expect(nodeCalls).toHaveLength(3);
    nodeCalls.forEach((call) => {
      expect(call[1].kind).toBe("codebase");
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// loadGraphFromNeo4j
// ─────────────────────────────────────────────────────────────────

describe("loadGraphFromNeo4j", () => {
  it("returns null when no Codebase nodes exist for the project (first run)", async () => {
    const mockSession = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).toBeNull();
  });

  it("returns KnowledgeGraph with empty project meta when Codebase nodes exist", async () => {
    // First-run check returns hasGraph=true; subsequent queries return empty
    // so the result has empty project meta and empty arrays for nodes/edges/layers/tour.
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    // project meta is reconstructed elsewhere (config.json / File aggregates),
    // not persisted on a :Project node any more.
    expect(result!.project.name).toBe("");
    expect(result!.project.languages).toEqual([]);
  });

  it("loads nodes from Neo4j and reconstructs GraphNode objects", async () => {
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        if (query.includes("MATCH (n:Codebase)")) {
          return {
            records: [
              {
                n: {
                  id: "node-1",
                  name: "index.ts",
                  type: "file",
                  summary: "Entry point",
                  filePath: "src/index.ts",
                  lineRange: [1, 50],
                  tags: ["entry"],
                  complexity: "simple",
                  languageNotes: null,
                  domainMeta: null,
                  knowledgeMeta: null,
                  rationale: null,
                  status: null,
                  scope: null,
                  condition: null,
                  invariant: null,
                  confidence: null,
                  subConcepts: null,
                  constrainedBy: null,
                  permissions: null,
                  restrictions: null,
                  ruleText: null,
                  analyzedAtCommit: "abc123",
                  kind: "codebase",
                  source: "code-analysis",
                  severity: null,
                  probability: null,
                  mitigation: null,
                },
              },
            ],
          };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(result!.nodes[0].id).toBe("node-1");
    expect(result!.nodes[0].name).toBe("index.ts");
    expect(result!.nodes[0].type).toBe("file");
    expect(result!.nodes[0].filePath).toBe("src/index.ts");
  });

  it("loads edges from Neo4j as RELATES relationships", async () => {
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        if (query.includes("MATCH (source:Codebase)-[r:RELATES]")) {
          return {
            records: [
              {
                r: {
                  source: "node-1",
                  target: "node-2",
                  type: "calls",
                  direction: "forward",
                  description: "calls foo",
                  weight: 0.9,
                },
              },
            ],
          };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0].source).toBe("node-1");
    expect(result!.edges[0].target).toBe("node-2");
    expect(result!.edges[0].type).toBe("calls");
    expect(result!.edges[0].weight).toBe(0.9);
  });

  it("loads layers from Neo4j", async () => {
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        if (query.includes("MATCH (l:Layer)")) {
          return {
            records: [
              {
                l: {
                  id: "layer-1",
                  name: "Core",
                  description: "Core layer",
                  nodeIds: ["node-1"],
                },
              },
            ],
          };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.layers).toHaveLength(1);
    expect(result!.layers[0].id).toBe("layer-1");
    expect(result!.layers[0].name).toBe("Core");
  });

  it("loads tour steps ordered by order property", async () => {
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        if (query.includes("MATCH (t:TourStep)")) {
          return {
            records: [
              { t: { order: 1, title: "Step 1", description: "First", nodeIds: ["node-1"], languageLesson: null } },
              { t: { order: 2, title: "Step 2", description: "Second", nodeIds: ["node-2"], languageLesson: null } },
            ],
          };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.tour).toHaveLength(2);
    expect(result!.tour[0].order).toBe(1);
    expect(result!.tour[0].title).toBe("Step 1");
  });

  it("returns empty arrays when no nodes/edges/layers/tour exist", async () => {
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never);

    expect(result).not.toBeNull();
    expect(result!.nodes).toEqual([]);
    expect(result!.edges).toEqual([]);
    expect(result!.layers).toEqual([]);
    expect(result!.tour).toEqual([]);
  });

  it("loads sourceFiles, generatedAt, sourceCommit from Neo4j", async () => {
    const mockSession = {
      run: vi.fn(async (query: string) => {
        if (query.includes("count(n) > 0")) {
          return { records: [{ hasGraph: true }] };
        }
        if (query.includes("MATCH (n:Codebase)")) {
          // Return nodes in the exact format loadGraphFromNeo4j expects: each record has an "n" key
          // with all node properties as Neo4j would return them after CREATE
          return {
            records: [
              {
                n: {
                  id: "node-codebase",
                  name: "index.ts",
                  type: "file",
                  summary: "Entry point",
                  tags: [],
                  complexity: "simple",
                  kind: "codebase",
                  generatedAt: "2026-06-01T00:00:00.000Z",
                  sourceCommit: "abc123",
                },
              },
              {
                n: {
                  id: "node-knowledge",
                  name: "Test Domain",
                  type: "domain",
                  summary: "A domain",
                  tags: [],
                  complexity: "moderate",
                  kind: "knowledge",
                  sourceFiles: JSON.stringify(["src/index.ts", "src/util.ts"]),
                  generatedAt: "2026-06-01T00:00:00.000Z",
                  sourceCommit: "def456",
                },
              },
            ],
          };
        }
        return { records: [] };
      }),
    };

    const result = await loadGraphFromNeo4j(mockSession as never, "project:singleton");

    expect(result).not.toBeNull();
    const codebaseNode = result!.nodes.find((n) => n.id === "node-codebase");
    expect(codebaseNode).toBeDefined();
    expect((codebaseNode as any).generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect((codebaseNode as any).sourceCommit).toBe("abc123");

    const knowledgeNode = result!.nodes.find((n) => n.id === "node-knowledge");
    expect(knowledgeNode).toBeDefined();
    expect((knowledgeNode as any).sourceFiles).toEqual(["src/index.ts", "src/util.ts"]);
    expect((knowledgeNode as any).generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect((knowledgeNode as any).sourceCommit).toBe("def456");
  });
});
});

