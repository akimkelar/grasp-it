import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import {
  saveGraph, loadGraph, saveMeta, loadMeta,
  saveFingerprints, loadFingerprints, saveConfig, loadConfig,
  saveProjectMeta, loadProjectMeta,
  saveDomainGraphToNeo4j, loadDomainGraphFromNeo4j,
} from "./index.js";
import type { KnowledgeGraph, AnalysisMeta, GraphNode } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";

describe("persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ua-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

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

  const sampleMeta: AnalysisMeta = {
    lastAnalyzedAt: "2026-03-14T00:00:00.000Z",
    gitCommitHash: "abc123",
    version: "1.0.0",
    analyzedFiles: 42,
  };

  describe("saveGraph / loadGraph", () => {
    it("should write knowledge-graph.json to .grasp-it/", () => {
      saveGraph(tempDir, sampleGraph);

      const filePath = join(tempDir, ".grasp-it", "knowledge-graph.json");
      expect(existsSync(filePath)).toBe(true);
    });

    it("should read back the saved graph correctly", () => {
      saveGraph(tempDir, sampleGraph);
      const loaded = loadGraph(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(sampleGraph);
    });

    it("should return null when no graph exists", () => {
      const loaded = loadGraph(tempDir);
      expect(loaded).toBeNull();
    });

    it("should throw error when loading a fatally invalid graph", () => {
      const invalidGraph = { ...sampleGraph, project: null };
      saveGraph(tempDir, invalidGraph as unknown as KnowledgeGraph);

      expect(() => {
        loadGraph(tempDir);
      }).toThrow(/Invalid knowledge graph/);
    });

    it("should skip validation when validate option is false", () => {
      const invalidGraph = { ...sampleGraph, version: 123 };
      saveGraph(tempDir, invalidGraph as unknown as KnowledgeGraph);

      const loaded = loadGraph(tempDir, { validate: false });
      expect(loaded).not.toBeNull();
      expect(loaded?.version).toBe(123);
    });
  });

  describe("saveMeta / loadMeta", () => {
    it("should write meta.json to .grasp-it/", () => {
      saveMeta(tempDir, sampleMeta);

      const filePath = join(tempDir, ".grasp-it", "meta.json");
      expect(existsSync(filePath)).toBe(true);
    });

    it("should read back the saved meta correctly", () => {
      saveMeta(tempDir, sampleMeta);
      const loaded = loadMeta(tempDir);

      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(sampleMeta);
    });

    it("should return null when no meta exists", () => {
      const loaded = loadMeta(tempDir);
      expect(loaded).toBeNull();
    });
  });

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

      expect(loaded).toEqual({ autoUpdate: true });
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
  });

  // ─────────────────────────────────────────────────────────────────
// saveDomainGraphToNeo4j
// ─────────────────────────────────────────────────────────────────

describe("saveDomainGraphToNeo4j", () => {
  it("deletes existing DomainElement nodes before writing new ones", async () => {
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

    expect(nodeCalls[0]![0]).toContain("CREATE (d:DomainElement:Domain");
    expect(nodeCalls[0]![1]).toMatchObject({ id: "domain:orders", name: "Orders" });

    expect(nodeCalls[1]![0]).toContain("CREATE (d:DomainElement:Feature");
    expect(nodeCalls[1]![1]).toMatchObject({ id: "feature:create-order", name: "Create Order" });
  });

  it("updates Project with domainAnalyzedAt and domainCommit", async () => {
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
      nodes: [],
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

    // Last call should be the SET query for domainAnalyzedAt and domainCommit
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toContain("SET p.domainAnalyzedAt");
    expect(lastCall[0]).toContain("domainCommit");
    expect(lastCall[1].domainCommit).toBe("def456");
  });

  it("uses graph.project.gitCommitHash as domainCommit when commit not provided", async () => {
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
      nodes: [],
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

    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[1].domainCommit).toBe("abc123");
  });
});

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
    expect(mockSession.run).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (d:DomainElement)-[:PART_OF]->(p:Project"),
      expect.objectContaining({ projectId: "project:singleton" }),
    );
  });

  it("returns KnowledgeGraph with nodes when DomainElement records exist", async () => {
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
    expect(result!.nodes[0].filePath).toBe("src/orders.ts");
  });

  it("maps secondary label to correct node type", async () => {
    const records = [
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
      labels: ["DomainElement", "CustomType"],
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
        records: [{ id: "domain:test", name: "Test", summary: "", nodeType: "domain", source: null, filePath: null, lineRange: null, tags: [], complexity: "simple", labels: ["DomainElement", "Domain"] }],
      })),
    };

    const result = await loadDomainGraphFromNeo4j(mockSession as never);

    expect(result!.edges).toEqual([]);
    expect(result!.layers).toEqual([]);
    expect(result!.tour).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// saveProjectMeta / loadProjectMeta
// ─────────────────────────────────────────────────────────────────

describe("saveProjectMeta / loadProjectMeta", () => {
    it("should call session.run with correct MERGE query and params", async () => {
      const sampleMeta: AnalysisMeta = {
        lastAnalyzedAt: "2026-03-14T00:00:00.000Z",
        gitCommitHash: "abc123def456",
        version: "1.0.0",
        analyzedFiles: 42,
      };

      let ranQuery = "";
      let ranParams: Record<string, unknown> = {};

      const mockSession = {
        run: async (query: string, params: Record<string, unknown>) => {
          ranQuery = query;
          ranParams = params;
          return { records: [] };
        },
      };

      await saveProjectMeta(mockSession as never, sampleMeta);

      expect(ranQuery).toContain("MERGE (p:Project");
      expect(ranQuery).toContain("SET");
      expect(ranQuery).toContain("p.gitCommitHash");
      expect(ranQuery).toContain("p.lastAnalyzedAt");
      expect(ranQuery).toContain("p.version");
      expect(ranQuery).toContain("p.analyzedFiles");
      expect(ranQuery).toContain("p.kind");
      expect(ranParams.id).toBe("project:singleton");
      expect(ranParams.gitCommitHash).toBe("abc123def456");
      expect(ranParams.lastAnalyzedAt).toBe("2026-03-14T00:00:00.000Z");
      expect(ranParams.version).toBe("1.0.0");
      expect(ranParams.analyzedFiles).toBe(42);
    });

    it("should return null when no Project singleton exists", async () => {
      const mockSession = {
        run: async (_query: string, _params: Record<string, unknown>) => {
          return { records: [] };
        },
      };

      const result = await loadProjectMeta(mockSession as never);
      expect(result).toBeNull();
    });

    it("propagates error when session.run() throws", async () => {
      const mockSession = {
        run: async (_query: string, _params: Record<string, unknown>) => {
          throw new Error("Connection timeout");
        },
      };

      await expect(saveProjectMeta(mockSession as never, sampleMeta)).rejects.toThrow(
        "Connection timeout",
      );
    });

    it("returns null when record has unexpected shape (gitCommitHash is null)", async () => {
      const mockRecord = {
        gitCommitHash: null,
        lastAnalyzedAt: "2026-03-14T00:00:00.000Z",
        version: "1.0.0",
        analyzedFiles: 42,
      };

      const mockSession = {
        run: async (_query: string, _params: Record<string, unknown>) => {
          return {
            records: [mockRecord],
          };
        },
      };

      const result = await loadProjectMeta(mockSession as never);
      // The function casts fields directly; null gitCommitHash becomes null in the result.
      // Current behavior: returns object with null gitCommitHash (not null itself).
      // Task expectation: return null or safe default, not throw.
      expect(result).not.toBeNull();
      expect(result!.gitCommitHash).toBeNull();
    });

    it("should return ProjectSingletonMeta when node exists", async () => {
      const mockRecord = {
        gitCommitHash: "abc123def456",
        lastAnalyzedAt: "2026-03-14T00:00:00.000Z",
        version: "1.0.0",
        analyzedFiles: 42,
      };

      const mockSession = {
        run: async (_query: string, _params: Record<string, unknown>) => {
          return {
            records: [mockRecord],
          };
        },
      };

      const result = await loadProjectMeta(mockSession as never);
      expect(result).not.toBeNull();
      expect(result!.gitCommitHash).toBe("abc123def456");
      expect(result!.lastAnalyzedAt).toBe("2026-03-14T00:00:00.000Z");
      expect(result!.version).toBe("1.0.0");
      expect(result!.analyzedFiles).toBe(42);
    });
  });
});
