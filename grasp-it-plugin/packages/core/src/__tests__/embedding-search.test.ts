import { describe, it, expect } from "vitest";
import { cosineSimilarity, SemanticSearchEngine } from "../embedding-search.js";
import type { GraphNode } from "../types.js";

const makeNode = (overrides: Partial<GraphNode> & { id: string; name: string }): GraphNode => ({
  type: "file",
  summary: "",
  tags: [],
  complexity: "simple",
  ...overrides,
});

describe("cosineSimilarity", () => {
  it("should handle zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("should return 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
  });
});

describe("SemanticSearchEngine", () => {
  const sampleNodes: GraphNode[] = [
    makeNode({ id: "node-a", name: "Alpha", type: "class" }),
    makeNode({ id: "node-b", name: "Beta", type: "function" }),
    makeNode({ id: "node-c", name: "Gamma", type: "class" }),
  ];

  const embeddings: Record<string, number[]> = {
    "node-a": [1, 0],      // vector along x-axis
    "node-b": [0, 1],      // vector along y-axis
    "node-c": [1, 1],      // vector at 45 degrees
  };

  describe("hasEmbeddings", () => {
    it("returns true when embeddings exist", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);
      expect(engine.hasEmbeddings()).toBe(true);
    });

    it("returns false when no embeddings", () => {
      const engine = new SemanticSearchEngine(sampleNodes, {});
      expect(engine.hasEmbeddings()).toBe(false);
    });
  });

  describe("search", () => {
    it("respects threshold filtering", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);

      // Query vector [1, 0] is identical to node-a (similarity=1, score=0)
      // node-c has similarity ~0.707 (score ~0.293)
      // node-b has similarity 0 (score=1)

      // With threshold 0.9, only node-a should be returned
      const results = engine.search([1, 0], { threshold: 0.9 });
      expect(results.length).toBe(1);
      expect(results[0].nodeId).toBe("node-a");
    });

    it("returns multiple results when below threshold", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);

      // With threshold 0.5, node-a and node-c should pass
      const results = engine.search([1, 0], { threshold: 0.5 });
      expect(results.length).toBe(2);
      const nodeIds = results.map((r) => r.nodeId);
      expect(nodeIds).toContain("node-a");
      expect(nodeIds).toContain("node-c");
    });

    it("respects type filtering", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);

      // Filter by class type - should exclude node-b (function)
      const results = engine.search([1, 0], { types: ["class"] });

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        const node = sampleNodes.find((n) => n.id === result.nodeId);
        expect(node?.type).toBe("class");
      }
      expect(results.some((r) => r.nodeId === "node-b")).toBe(false);
    });

    it("returns results sorted by score (lower is better)", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);

      const results = engine.search([1, 0], { threshold: 0 });

      // node-a: similarity 1, score 0 (best match)
      // node-c: similarity 0.707, score ~0.293
      // node-b: similarity 0, score 1 (worst match)
      expect(results[0].nodeId).toBe("node-a");
      expect(results[0].score).toBe(0);
    });

    it("respects limit option", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);
      const results = engine.search([1, 0], { limit: 1 });
      expect(results.length).toBe(1);
    });
  });

  describe("updateNodes", () => {
    it("replaces nodes and searches against new nodes", () => {
      const engine = new SemanticSearchEngine(sampleNodes, embeddings);

      // Initially search returns results for original nodes
      const beforeResults = engine.search([1, 0]);
      expect(beforeResults.some((r) => r.nodeId === "node-a")).toBe(true);

      // Update with new nodes (no embeddings for new nodes)
      const newNodes = [
        makeNode({ id: "node-new", name: "NewNode", type: "module" }),
      ];
      engine.updateNodes(newNodes);

      // Old nodes should not be found
      const afterResults = engine.search([1, 0]);
      expect(afterResults.some((r) => r.nodeId === "node-a")).toBe(false);
      // node-new has no embedding, so no results
      expect(afterResults.length).toBe(0);
    });
  });
});
