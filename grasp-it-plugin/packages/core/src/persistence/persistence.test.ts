import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync } from "node:fs";
import {
  saveGraph, loadGraph, saveMeta, loadMeta,
  saveFingerprints, loadFingerprints, saveConfig, loadConfig,
  saveProjectMeta, loadProjectMeta,
} from "./index.js";
import type { KnowledgeGraph, AnalysisMeta } from "../types.js";
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
