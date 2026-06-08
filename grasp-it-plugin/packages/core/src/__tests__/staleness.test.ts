import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "../types.js";
import type { ProjectSingletonMeta } from "../types.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:path", () => ({
  join: vi.fn((...args: string[]) => args.join("/")),
}));

// Import after mocking
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  getChangedFiles,
  isStale,
  checkGraphFreshness,
  checkGraphFreshnessFromFiles,
  mergeGraphUpdate,
  findStaleImplementedBy,
} from "../staleness.js";
import { loadProjectMeta } from "../persistence/index.js";

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
// checkGraphFreshness — Neo4j-first
// ─────────────────────────────────────────────────────────────────

describe("checkGraphFreshness (Neo4j-first)", () => {
  const mockedExistsSync = vi.mocked(existsSync);
  const mockedReadFileSync = vi.mocked(readFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries Neo4j when session is provided", async () => {
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

  it("falls back to JSON files when session throws (Neo4j unavailable)", async () => {
    const session = makeFailingNeo4jSession();
    // Mock JSON fallback — knowledge-graph.json exists with matching commit
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ project: { gitCommitHash: "abc123", name: "test" } }),
    );
    mockedExecFileSync.mockReturnValue("abc123");

    const result = await checkGraphFreshness("/project", session);

    // Should fall through to JSON files and succeed
    expect(result).toEqual({
      stale: false,
      lastCommit: "abc123",
      headCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("falls back to JSON files when session is undefined", async () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ project: { gitCommitHash: "abc123", name: "test" } }),
    );
    mockedExecFileSync.mockReturnValue("abc123");

    const result = await checkGraphFreshness("/project");

    expect(result).toEqual({
      stale: false,
      lastCommit: "abc123",
      headCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("falls back to JSON files when Neo4j returns no records (first run)", async () => {
    const session = makeNeo4jSession(null);
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ project: { gitCommitHash: "abc123", name: "test" } }),
    );
    mockedExecFileSync.mockReturnValue("abc123");

    const result = await checkGraphFreshness("/project", session);

    expect(result).toEqual({
      stale: false,
      lastCommit: "abc123",
      headCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("returns stale=true when neither Neo4j nor JSON files have data", async () => {
    const session = makeNeo4jSession(null);
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue("{}");

    const result = await checkGraphFreshness("/project", session);

    expect(result).toEqual({
      stale: true,
      lastCommit: "",
      headCommit: "",
      commitsBehind: 0,
    });
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
// checkGraphFreshnessFromFiles — legacy JSON fallback
// ─────────────────────────────────────────────────────────────────

describe("checkGraphFreshnessFromFiles (legacy JSON fallback)", () => {
  const mockedExistsSync = vi.mocked(existsSync);
  const mockedReadFileSync = vi.mocked(readFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stale=true when neither knowledge-graph.json nor meta.json exists", () => {
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue("{}");

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: true,
      lastCommit: "",
      headCommit: "",
      commitsBehind: 0,
    });
  });

  it("returns stale=false when graph commit matches HEAD", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        project: { gitCommitHash: "abc123", name: "test" },
      }),
    );
    mockedExecFileSync.mockReturnValue("abc123");

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: false,
      lastCommit: "abc123",
      headCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("returns stale=true with correct commitsBehind when graph is behind HEAD", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        project: { gitCommitHash: "abc123", name: "test" },
      }),
    );
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "git" && args?.[0] === "rev-parse") return "def456";
      if (cmd === "git" && args?.[0] === "rev-list") return "5";
      return "";
    });

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: true,
      lastCommit: "abc123",
      headCommit: "def456",
      commitsBehind: 5,
    });
  });

  it("falls back to meta.json when knowledge-graph.json is not available", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return false;
      if (path === "/project/.grasp-it/meta.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify({ gitCommitHash: "abc123" }));
    mockedExecFileSync.mockReturnValue("abc123");

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: false,
      lastCommit: "abc123",
      headCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("handles git error when getting HEAD gracefully", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ project: { gitCommitHash: "abc123", name: "test" } }),
    );
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "git" && args?.[0] === "rev-parse") {
        throw new Error("fatal: not a git repo");
      }
      return "";
    });

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: true,
      lastCommit: "abc123",
      headCommit: "",
      commitsBehind: 0,
    });
  });

  it("handles git error when counting commits (e.g., rebased commit)", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ project: { gitCommitHash: "abc123", name: "test" } }),
    );
    mockedExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === "git" && args?.[0] === "rev-parse") return "def456";
      if (cmd === "git" && args?.[0] === "rev-list") {
        throw new Error("fatal: bad revision");
      }
      return "";
    });

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: true,
      lastCommit: "abc123",
      headCommit: "def456",
      commitsBehind: 0,
    });
  });

  it("falls back gracefully when knowledge-graph.json contains invalid JSON", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue("not-valid-json{{");

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: true,
      lastCommit: "",
      headCommit: "",
      commitsBehind: 0,
    });
  });

  it("falls back gracefully when knowledge-graph.json is missing project.gitCommitHash", () => {
    mockedExistsSync.mockImplementation((path) => {
      if (path === "/project/.grasp-it/knowledge-graph.json") return true;
      return false;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify({ nodes: [], edges: [] }));

    const result = checkGraphFreshnessFromFiles("/project");

    expect(result).toEqual({
      stale: true,
      lastCommit: "",
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