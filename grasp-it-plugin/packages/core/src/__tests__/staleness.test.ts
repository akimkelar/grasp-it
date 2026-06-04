import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../types.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Import after mocking
import { execFileSync } from "child_process";
import { getChangedFiles, isStale, mergeGraphUpdate, findStaleImplementedBy } from "../staleness.js";

const mockedExecFileSync = vi.mocked(execFileSync);

const makeNode = (
  overrides: Partial<GraphNode> & { id: string; name: string },
): GraphNode => ({
  type: "file",
  summary: "",
  tags: [],
  complexity: "simple",
  ...overrides,
});

const makeEdge = (
  overrides: Partial<GraphEdge> & { source: string; target: string },
): GraphEdge => ({
  type: "imports",
  direction: "forward",
  weight: 1,
  ...overrides,
});

function makeGraph(overrides?: Partial<KnowledgeGraph>): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: {
      name: "test-project",
      languages: ["typescript"],
      frameworks: [],
      description: "A test project",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      gitCommitHash: "abc123",
    },
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getChangedFiles", () => {
  it("returns changed file list from git diff", () => {
    mockedExecFileSync.mockReturnValue("src/index.ts\nsrc/utils.ts\n");

    const result = getChangedFiles("/project", "abc123");

    expect(result).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "abc123..HEAD", "--name-only"],
      { cwd: "/project", encoding: "utf-8" },
    );
  });

  it("returns empty array when no changes", () => {
    mockedExecFileSync.mockReturnValue("");

    const result = getChangedFiles("/project", "abc123");

    expect(result).toEqual([]);
  });

  it("returns empty array on git error", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("fatal: bad revision");
    });

    const result = getChangedFiles("/project", "abc123");

    expect(result).toEqual([]);
  });
});

describe("isStale", () => {
  it("returns stale when files have changed", () => {
    mockedExecFileSync.mockReturnValue("src/index.ts\n");

    const result = isStale("/project", "abc123");

    expect(result).toEqual({
      stale: true,
      changedFiles: ["src/index.ts"],
    });
  });

  it("returns not stale when no files changed", () => {
    mockedExecFileSync.mockReturnValue("");

    const result = isStale("/project", "abc123");

    expect(result).toEqual({
      stale: false,
      changedFiles: [],
    });
  });
});

describe("mergeGraphUpdate", () => {
  it("replaces nodes for changed files", () => {
    const existingGraph = makeGraph({
      nodes: [
        makeNode({
          id: "file-a",
          name: "a.ts",
          filePath: "src/a.ts",
          summary: "Old summary",
        }),
        makeNode({
          id: "file-b",
          name: "b.ts",
          filePath: "src/b.ts",
          summary: "Unchanged",
        }),
        makeNode({
          id: "func-a1",
          name: "funcA1",
          type: "function",
          filePath: "src/a.ts",
          summary: "Old function",
        }),
      ],
    });

    const newNodes = [
      makeNode({
        id: "file-a-v2",
        name: "a.ts",
        filePath: "src/a.ts",
        summary: "New summary",
      }),
      makeNode({
        id: "func-a2",
        name: "funcA2",
        type: "function",
        filePath: "src/a.ts",
        summary: "New function",
      }),
    ];

    const result = mergeGraphUpdate(
      existingGraph,
      ["src/a.ts"],
      newNodes,
      [],
      "def456",
    );

    // Old nodes from src/a.ts should be gone
    expect(result.nodes.find((n) => n.id === "file-a")).toBeUndefined();
    expect(result.nodes.find((n) => n.id === "func-a1")).toBeUndefined();

    // New nodes should be present
    expect(result.nodes.find((n) => n.id === "file-a-v2")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "func-a2")).toBeDefined();

    // Unchanged file should remain
    expect(result.nodes.find((n) => n.id === "file-b")).toBeDefined();
  });

  it("removes edges originating from changed files", () => {
    const existingGraph = makeGraph({
      nodes: [
        makeNode({ id: "file-a", name: "a.ts", filePath: "src/a.ts" }),
        makeNode({ id: "file-b", name: "b.ts", filePath: "src/b.ts" }),
        makeNode({ id: "file-c", name: "c.ts", filePath: "src/c.ts" }),
      ],
      edges: [
        // Edge from changed file -> should be removed
        makeEdge({ source: "file-a", target: "file-b" }),
        // Edge between unchanged files -> should remain
        makeEdge({ source: "file-b", target: "file-c" }),
        // Edge to changed file from unchanged -> should remain
        makeEdge({ source: "file-c", target: "file-a" }),
      ],
    });

    const newNodes = [
      makeNode({
        id: "file-a-v2",
        name: "a.ts",
        filePath: "src/a.ts",
        summary: "Updated",
      }),
    ];

    const newEdges = [
      makeEdge({ source: "file-a-v2", target: "file-c" }),
    ];

    const result = mergeGraphUpdate(
      existingGraph,
      ["src/a.ts"],
      newNodes,
      newEdges,
      "def456",
    );

    // Old edge from file-a should be removed
    expect(
      result.edges.find(
        (e) => e.source === "file-a" && e.target === "file-b",
      ),
    ).toBeUndefined();

    // Edge between unchanged files should remain
    expect(
      result.edges.find(
        (e) => e.source === "file-b" && e.target === "file-c",
      ),
    ).toBeDefined();

    // Edge to changed file from unchanged should be removed (dangling target)
    expect(
      result.edges.find(
        (e) => e.source === "file-c" && e.target === "file-a",
      ),
    ).toBeUndefined();

    // New edge should be added
    expect(
      result.edges.find(
        (e) => e.source === "file-a-v2" && e.target === "file-c",
      ),
    ).toBeDefined();
  });

  it("updates analyzedAt timestamp and gitCommitHash", () => {
    const existingGraph = makeGraph();

    const before = new Date().toISOString();
    const result = mergeGraphUpdate(existingGraph, [], [], [], "def456");
    const after = new Date().toISOString();

    expect(result.project.gitCommitHash).toBe("def456");
    expect(result.project.analyzedAt >= before).toBe(true);
    expect(result.project.analyzedAt <= after).toBe(true);
  });

  it("removes cross-file dangling edges when target node is replaced", () => {
    // Scenario: file A (unchanged) has a CALLS edge to function:fileB:oldFn
    // file B is re-analyzed with oldFn renamed to newFn
    // After merge, the CALLS edge should not exist
    const existingGraph = makeGraph({
      nodes: [
        makeNode({ id: "file:a", name: "a.ts", filePath: "src/a.ts" }),
        makeNode({ id: "file:b", name: "b.ts", filePath: "src/b.ts" }),
        makeNode({
          id: "function:src/b.ts:oldFn",
          name: "oldFn",
          type: "function",
          filePath: "src/b.ts",
        }),
      ],
      edges: [
        // Edge from unchanged file A to old function in changed file B
        // This is the dangling edge that should be removed
        makeEdge({
          source: "file:a",
          target: "function:src/b.ts:oldFn",
          type: "calls",
        }),
      ],
    });

    // New analysis of file B: oldFn renamed to newFn
    const newNodes = [
      makeNode({
        id: "file:b-v2",
        name: "b.ts",
        filePath: "src/b.ts",
      }),
      makeNode({
        id: "function:src/b.ts:newFn",
        name: "newFn",
        type: "function",
        filePath: "src/b.ts",
      }),
    ];

    const result = mergeGraphUpdate(
      existingGraph,
      ["src/b.ts"],
      newNodes,
      [],
      "def456",
    );

    // The dangling edge should be removed
    expect(
      result.edges.find(
        (e) =>
          e.source === "file:a" && e.target === "function:src/b.ts:oldFn",
      ),
    ).toBeUndefined();

    // The new function should exist
    expect(
      result.nodes.find((n) => n.id === "function:src/b.ts:newFn"),
    ).toBeDefined();

    // The old function should not exist
    expect(
      result.nodes.find((n) => n.id === "function:src/b.ts:oldFn"),
    ).toBeUndefined();
  });

  it("keeps cross-file edges when target still exists after merge", () => {
    // Scenario: file A (unchanged) has a CALLS edge to function:fileB:existingFn
    // file B is re-analyzed but existingFn is not changed
    // After merge, the CALLS edge should still exist
    const existingGraph = makeGraph({
      nodes: [
        makeNode({ id: "file:a", name: "a.ts", filePath: "src/a.ts" }),
        makeNode({ id: "file:b", name: "b.ts", filePath: "src/b.ts" }),
        makeNode({
          id: "function:src/b.ts:existingFn",
          name: "existingFn",
          type: "function",
          filePath: "src/b.ts",
        }),
      ],
      edges: [
        makeEdge({
          source: "file:a",
          target: "function:src/b.ts:existingFn",
          type: "calls",
        }),
      ],
    });

    // New analysis of file B: adds a new function but keeps existingFn
    const newNodes = [
      makeNode({
        id: "file:b-v2",
        name: "b.ts",
        filePath: "src/b.ts",
      }),
      makeNode({
        id: "function:src/b.ts:existingFn",
        name: "existingFn",
        type: "function",
        filePath: "src/b.ts",
      }),
      makeNode({
        id: "function:src/b.ts:newFn",
        name: "newFn",
        type: "function",
        filePath: "src/b.ts",
      }),
    ];

    const result = mergeGraphUpdate(
      existingGraph,
      ["src/b.ts"],
      newNodes,
      [],
      "def456",
    );

    // The edge to existingFn should be kept
    expect(
      result.edges.find(
        (e) =>
          e.source === "file:a" && e.target === "function:src/b.ts:existingFn",
      ),
    ).toBeDefined();
  });
});

describe("findStaleImplementedBy", () => {
  it("returns empty when no files have analyzedAtCommit", () => {
    const graph = makeGraph({
      nodes: [
        makeNode({ id: "file:src/a.ts", name: "a.ts", filePath: "src/a.ts", type: "file" }),
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "implemented_by" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "abc123");
    expect(result.staleEdges).toHaveLength(0);
  });

  it("returns empty when file analyzedAtCommit equals current commit", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "abc123" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "implemented_by" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "abc123");
    expect(result.staleEdges).toHaveLength(0);
  });

  it("identifies stale edge when file was analyzed at an older commit", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "implemented_by" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "newCommit");
    expect(result.staleEdges).toHaveLength(1);
    expect(result.staleEdges[0].nodeId).toBe("feature:auth");
    expect(result.staleEdges[0].nodeName).toBe("Auth Feature");
    expect(result.staleEdges[0].nodeType).toBe("feature");
    expect(result.staleEdges[0].analyzedAtCommit).toBe("oldCommit");
  });

  it("handles multiple stale edges correctly", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        { id: "file:src/b.ts", type: "file", name: "b.ts", filePath: "src/b.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
        makeNode({ id: "operation:login", name: "Login", type: "operation" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "implemented_by" }),
        makeEdge({ source: "operation:login", target: "file:src/b.ts", type: "implemented_by" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "newCommit");
    expect(result.staleEdges).toHaveLength(2);
    expect(result.staleEdges.map(e => e.nodeId)).toContain("feature:auth");
    expect(result.staleEdges.map(e => e.nodeId)).toContain("operation:login");
  });

  it("reports the changed file's filePath (not the knowledge node's)", () => {
    // file:src/a.ts has no analyzedAtCommit — edge to it should be ignored
    // file:src/b.ts has oldCommit != currentCommit — edge to it is stale
    // The stale result's filePath should be the File node's filePath (src/b.ts),
    // not the knowledge node's filePath (feature:auth has no filePath)
    const testGraph = makeGraph({
      nodes: [
        makeNode({ id: "file:src/a.ts", name: "a.ts", filePath: "src/a.ts", type: "file" }),
        { id: "file:src/b.ts", type: "file", name: "b.ts", filePath: "src/b.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "implemented_by" }),
        makeEdge({ source: "feature:auth", target: "file:src/b.ts", type: "implemented_by" }),
      ],
    });
    const result = findStaleImplementedBy(testGraph, "newCommit");
    expect(result.staleEdges).toHaveLength(1);
    expect(result.staleEdges[0].nodeId).toBe("feature:auth");
    expect(result.staleEdges[0].filePath).toBe("src/b.ts");
  });

  it("returns empty when no implemented_by edges exist", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "has_feature" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "newCommit");
    expect(result.staleEdges).toHaveLength(0);
  });

  it("reports the changed file's path in the stale edge result", () => {
    // The filePath in StaleEdge is the target File node's path (which file changed)
    // not the knowledge node's filePath (which may not exist)
    const graph = makeGraph({
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/a.ts", type: "implemented_by" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "newCommit");
    expect(result.staleEdges).toHaveLength(1);
    // filePath is the file node's filePath (which file was re-analyzed)
    expect(result.staleEdges[0].filePath).toBe("src/a.ts");
  });
});
