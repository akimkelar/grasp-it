import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../types.js";
import type { ProjectSingletonMeta } from "../types.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Import after mocking
import { execFileSync } from "child_process";
import {
  getChangedFiles,
  isStale,
  checkGraphFreshness,
  mergeGraphUpdate,
  findStaleImplementedBy,
  buildStaleImplementedByCypher,
} from "../staleness.js";

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

// ─────────────────────────────────────────────────────────────────
// Mock Neo4j session factory
// ─────────────────────────────────────────────────────────────────

type MockSession = {
  run: ReturnType<typeof vi.fn>;
};

/** Creates a mock Neo4j session that returns the given ProjectSingletonMeta. */
function makeNeo4jSession(meta: ProjectSingletonMeta | null): MockSession {
  return {
    run: vi.fn(async () => {
      if (!meta) return { records: [] };
      return {
        records: [
          {
            gitCommitHash: meta.gitCommitHash,
            lastAnalyzedAt: meta.lastAnalyzedAt,
            version: meta.version,
            analyzedFiles: meta.analyzedFiles,
          },
        ],
      };
    }),
  };
}

/** Creates a mock Neo4j session that throws when run (simulates connection failure). */
function makeFailingNeo4jSession(): MockSession {
  return {
    run: vi.fn(async () => {
      throw new Error("Connection refused");
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// getChangedFiles
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// isStale
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// checkGraphFreshness — Neo4j-only (no JSON fallback)
// ─────────────────────────────────────────────────────────────────

describe("checkGraphFreshness (Neo4j-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries Neo4j and returns stale=false when commit matches HEAD", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "abc123",
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
      version: "1.0.0",
      analyzedFiles: 10,
    });
    mockedExecFileSync.mockReturnValue("abc123");

    const result = await checkGraphFreshness("/project", session);

    expect(session.run).toHaveBeenCalled();
    expect(result).toEqual({
      stale: false,
      lastCommit: "abc123",
      headCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("returns stale=true when Neo4j commit differs from HEAD", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "abc123",
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
      version: "1.0.0",
      analyzedFiles: 10,
    });
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "git" && args?.[0] === "rev-parse") return "def456";
      if (cmd === "git" && args?.[0] === "rev-list") return "5";
      return "";
    });

    const result = await checkGraphFreshness("/project", session);

    expect(result).toEqual({
      stale: true,
      lastCommit: "abc123",
      headCommit: "def456",
      commitsBehind: 5,
    });
  });

  it("throws when session.run() throws (Neo4j unavailable)", async () => {
    const session = makeFailingNeo4jSession();

    await expect(checkGraphFreshness("/project", session)).rejects.toThrow(
      "Connection refused",
    );
  });

  it("throws with 'No analysis found. Run /grasp first.' when Neo4j returns no records", async () => {
    const session = makeNeo4jSession(null);

    await expect(checkGraphFreshness("/project", session)).rejects.toThrow(
      "No analysis found. Run /grasp first.",
    );
  });

  it("throws with 'No analysis found. Run /grasp first.' when session is undefined", async () => {
    mockedExecFileSync.mockReturnValue("abc123");

    await expect(checkGraphFreshness("/project")).rejects.toThrow(
      "No analysis found. Run /grasp first.",
    );
  });

  it("gracefully handles HEAD git error after Neo4j success", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "abc123",
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
      version: "1.0.0",
      analyzedFiles: 10,
    });
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "git" && args?.[0] === "rev-parse") {
        throw new Error("fatal: not a git repo");
      }
      return "";
    });

    const result = await checkGraphFreshness("/project", session);

    expect(result).toEqual({
      stale: true,
      lastCommit: "abc123",
      headCommit: "",
      commitsBehind: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// mergeGraphUpdate
// ─────────────────────────────────────────────────────────────────

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
      result.edges.find((e) => e.source === "file-a" && e.target === "file-b"),
    ).toBeUndefined();

    // Edge between unchanged files should remain
    expect(
      result.edges.find((e) => e.source === "file-b" && e.target === "file-c"),
    ).toBeDefined();

    // Edge to changed file from unchanged should be removed (dangling target)
    expect(
      result.edges.find((e) => e.source === "file-c" && e.target === "file-a"),
    ).toBeUndefined();

    // New edge should be added
    expect(
      result.edges.find((e) => e.source === "file-a-v2" && e.target === "file-c"),
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
        makeEdge({
          source: "file:a",
          target: "function:src/b.ts:oldFn",
          type: "calls",
        }),
      ],
    });

    const newNodes = [
      makeNode({ id: "file:b-v2", name: "b.ts", filePath: "src/b.ts" }),
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

    expect(
      result.edges.find(
        (e) => e.source === "file:a" && e.target === "function:src/b.ts:oldFn",
      ),
    ).toBeUndefined();
    expect(
      result.nodes.find((n) => n.id === "function:src/b.ts:newFn"),
    ).toBeDefined();
    expect(
      result.nodes.find((n) => n.id === "function:src/b.ts:oldFn"),
    ).toBeUndefined();
  });

  it("keeps cross-file edges when target still exists after merge", () => {
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

    const newNodes = [
      makeNode({ id: "file:b-v2", name: "b.ts", filePath: "src/b.ts" }),
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

    expect(
      result.edges.find(
        (e) =>
          e.source === "file:a" && e.target === "function:src/b.ts:existingFn",
      ),
    ).toBeDefined();
  });

  it("removes outbound edges from a source node whose ID changed after re-analysis", () => {
    const existingGraph = makeGraph({
      nodes: [
        makeNode({ id: "file:a", name: "a.ts", filePath: "src/a.ts" }),
        makeNode({ id: "file:b", name: "b.ts", filePath: "src/b.ts" }),
        makeNode({
          id: "function:src/a.ts:foo",
          name: "foo",
          type: "function",
          filePath: "src/a.ts",
        }),
        makeNode({
          id: "function:src/b.ts:bar",
          name: "bar",
          type: "function",
          filePath: "src/b.ts",
        }),
      ],
      edges: [
        makeEdge({
          source: "function:src/a.ts:foo",
          target: "function:src/b.ts:bar",
          type: "calls",
        }),
      ],
    });

    const newNodes = [
      makeNode({ id: "file:a-v2", name: "a.ts", filePath: "src/a.ts" }),
      makeNode({
        id: "function:src/a.ts:baz",
        name: "baz",
        type: "function",
        filePath: "src/a.ts",
      }),
      makeNode({
        id: "function:src/b.ts:bar",
        name: "bar",
        type: "function",
        filePath: "src/b.ts",
      }),
    ];

    const result = mergeGraphUpdate(
      existingGraph,
      ["src/a.ts"],
      newNodes,
      [],
      "def456",
    );

    expect(
      result.nodes.find((n) => n.id === "function:src/a.ts:foo"),
    ).toBeUndefined();
    expect(
      result.nodes.find((n) => n.id === "function:src/a.ts:baz"),
    ).toBeDefined();
    expect(
      result.edges.find(
        (e) =>
          e.source === "function:src/a.ts:foo" && e.target === "function:src/b.ts:bar",
      ),
    ).toBeUndefined();
  });

  it("file nodes in the incremental update carry analyzedAtCommit matching the new commit", () => {
    const existingGraph = makeGraph({
      nodes: [
        makeNode({
          id: "file:src/a.ts",
          name: "a.ts",
          filePath: "src/a.ts",
          type: "file",
          analyzedAtCommit: "oldHash",
        }),
        makeNode({
          id: "file:src/b.ts",
          name: "b.ts",
          filePath: "src/b.ts",
          type: "file",
        }),
      ],
    });

    const newNodes = [
      makeNode({
        id: "file:src/a.ts-v2",
        name: "a.ts",
        filePath: "src/a.ts",
        type: "file",
        analyzedAtCommit: "newHash",
      }),
    ];

    const result = mergeGraphUpdate(
      existingGraph,
      ["src/a.ts"],
      newNodes,
      [],
      "newHash",
    );

    const newFileNode = result.nodes.find((n) => n.filePath === "src/a.ts");
    expect(newFileNode).toBeDefined();
    expect(newFileNode!.analyzedAtCommit).toBe("newHash");
  });
});

// ─────────────────────────────────────────────────────────────────
// findStaleImplementedBy
// ─────────────────────────────────────────────────────────────────

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
    expect(result.staleEdges.map((e) => e.nodeId)).toContain("feature:auth");
    expect(result.staleEdges.map((e) => e.nodeId)).toContain("operation:login");
  });

  it("reports the changed file's filePath (not the knowledge node's)", () => {
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
    expect(result.staleEdges[0].filePath).toBe("src/a.ts");
  });

  it("returns only stale edges when a knowledge node has multiple IMPLEMENTED_BY edges and only some are stale", () => {
    const graph = makeGraph({
      nodes: [
        { id: "file:src/auth.ts", type: "file", name: "auth.ts", filePath: "src/auth.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "oldCommit" },
        { id: "file:src/auth-utils.ts", type: "file", name: "auth-utils.ts", filePath: "src/auth-utils.ts", summary: "", tags: [], complexity: "simple" as const, analyzedAtCommit: "newCommit" },
        makeNode({ id: "feature:auth", name: "Auth Feature", type: "feature" }),
      ],
      edges: [
        makeEdge({ source: "feature:auth", target: "file:src/auth.ts", type: "implemented_by" }),
        makeEdge({ source: "feature:auth", target: "file:src/auth-utils.ts", type: "implemented_by" }),
      ],
    });

    const result = findStaleImplementedBy(graph, "newCommit");
    expect(result.staleEdges).toHaveLength(1);
    expect(result.staleEdges[0].nodeId).toBe("feature:auth");
    expect(result.staleEdges[0].filePath).toBe("src/auth.ts");
    expect(result.staleEdges[0].analyzedAtCommit).toBe("oldCommit");
  });
});

// ─────────────────────────────────────────────────────────────────
// buildStaleImplementedByCypher — Neo4j Cypher builder
// ─────────────────────────────────────────────────────────────────

describe("buildStaleImplementedByCypher", () => {
  it("returns a non-empty Cypher string", () => {
    const result = buildStaleImplementedByCypher();
    expect(result.cypher).toBeTruthy();
    expect(typeof result.cypher).toBe("string");
    expect(result.cypher.length).toBeGreaterThan(0);
  });

  it("contains the expected MATCH/WHERE/RETURN/ORDER BY clauses", () => {
    const { cypher } = buildStaleImplementedByCypher();
    expect(cypher).toContain("MATCH (k)-[r:IMPLEMENTED_BY]->(f:File)");
    expect(cypher).toContain("WHERE f.analyzedAtCommit IS NOT NULL");
    expect(cypher).toContain("RETURN k.id");
    expect(cypher).toContain("ORDER BY f.analyzedAtCommit");
  });

  it("uses $currentCommit as a parameter (no string interpolation of the commit hash)", () => {
    const { cypher } = buildStaleImplementedByCypher();
    expect(cypher).toContain("$currentCommit");
    // The Cypher must NOT embed a literal commit hash — that would be injection-prone.
    // The empty params.currentCommit is a placeholder, not a hash.
    expect(cypher).not.toMatch(/abc123|def456|deadbeef/);
  });

  it("returns a params object with a currentCommit field", () => {
    const { params } = buildStaleImplementedByCypher();
    expect(params).toBeDefined();
    expect(params).toHaveProperty("currentCommit");
    // The placeholder is empty — the caller fills in the actual hash.
    expect(params.currentCommit).toBe("");
  });

  it("returns shape matching the StalenessCypherQuery interface", () => {
    const result = buildStaleImplementedByCypher();
    // Shape: { cypher: string, params: { currentCommit: string } }
    expect(typeof result.cypher).toBe("string");
    expect(typeof result.params).toBe("object");
    expect(result.params).not.toBeNull();
    expect(typeof (result.params as Record<string, unknown>).currentCommit).toBe("string");
  });

  it("filters out files with null analyzedAtCommit (legacy unanalyzed files)", () => {
    const { cypher } = buildStaleImplementedByCypher();
    // The WHERE clause must include the IS NOT NULL filter so legacy
    // (pre-Task 21) File nodes are excluded from staleness results.
    expect(cypher).toMatch(/WHERE[\s\S]*analyzedAtCommit IS NOT NULL/);
  });

  it("returns the same query on repeated calls (deterministic)", () => {
    const a = buildStaleImplementedByCypher();
    const b = buildStaleImplementedByCypher();
    expect(a.cypher).toBe(b.cypher);
    expect(a.params).toEqual(b.params);
  });
});