import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MERGE_SCRIPT = resolve(__dirname, "../../skills/grasp/merge-batch-graphs.py");

let projectRoot;
let intermediateDir;

function runMerge() {
  const result = spawnSync("python3", [MERGE_SCRIPT, projectRoot], {
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`merge script failed: status=${result.status}\nstderr:\n${result.stderr}`);
  }
  const assembled = JSON.parse(
    readFileSync(join(intermediateDir, "assembled-graph.json"), "utf-8"),
  );
  return { assembled, stderr: result.stderr };
}

function fileNode(path) {
  return {
    id: `file:${path}`,
    type: "file",
    name: path.split("/").pop(),
    filePath: path,
    summary: "",
    tags: [],
    complexity: "simple",
  };
}

function importsEdge(src, tgt) {
  return {
    source: `file:${src}`,
    target: `file:${tgt}`,
    type: "imports",
    direction: "forward",
    weight: 0.7,
  };
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "ua-merge-test-"));
  intermediateDir = join(projectRoot, ".grasp-it", "intermediate");
  mkdirSync(intermediateDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

// ── Helper builders ──────────────────────────────────────────────────────
function funcNode(filePath, name) {
  return {
    id: `func:${filePath}:${name}`,
    type: "function",
    name,
    filePath,
    summary: "",
    tags: [],
    complexity: "simple",
  };
}

function writeBatch(n, data) {
  writeFileSync(
    join(intermediateDir, `batch-${n}.json`),
    JSON.stringify(data),
  );
}

// ── Core merge logic ─────────────────────────────────────────────────────

describe("merge-batch-graphs.py — node deduplication", () => {
  it("keeps the LAST occurrence when two batches emit the same node id", () => {
    writeBatch(0, {
      nodes: [{ id: "file:src/a.py", type: "file", name: "a.py", filePath: "src/a.py", summary: "first", tags: [], complexity: "simple" }],
      edges: [],
    });
    writeBatch(1, {
      nodes: [{ id: "file:src/a.py", type: "file", name: "a.py", filePath: "src/a.py", summary: "second (updated)", tags: [], complexity: "moderate" }],
      edges: [],
    });
    const { assembled, stderr } = runMerge();
    expect(assembled.nodes).toHaveLength(1);
    expect(assembled.nodes[0].summary).toBe("second (updated)");
    expect(assembled.nodes[0].complexity).toBe("moderate");
    expect(stderr).toContain("duplicate node IDs removed");
  });
});

describe("merge-batch-graphs.py — edge deduplication and dangling edge drops", () => {
  it("deduplicates edges with the same (source, target, type, direction), keeping higher weight", () => {
    const nodeA = fileNode("src/a.py");
    const nodeB = fileNode("src/b.py");
    writeBatch(0, {
      nodes: [nodeA, nodeB],
      edges: [
        { source: "file:src/a.py", target: "file:src/b.py", type: "imports", direction: "forward", weight: 0.3 },
        { source: "file:src/a.py", target: "file:src/b.py", type: "imports", direction: "forward", weight: 0.9 },
      ],
    });
    const { assembled } = runMerge();
    const imp = assembled.edges.filter((e) => e.type === "imports");
    expect(imp).toHaveLength(1);
    expect(imp[0].weight).toBe(0.9);
  });

  it("drops edges where the source node is missing from the graph", () => {
    writeBatch(0, {
      nodes: [fileNode("src/b.py")],
      edges: [
        { source: "file:src/missing.py", target: "file:src/b.py", type: "imports", direction: "forward", weight: 0.5 },
      ],
    });
    const { assembled, stderr } = runMerge();
    expect(assembled.edges).toHaveLength(0);
    expect(stderr).toContain("missing source 'file:src/missing.py'");
  });

  it("drops edges where the target node is missing from the graph", () => {
    writeBatch(0, {
      nodes: [fileNode("src/a.py")],
      edges: [
        { source: "file:src/a.py", target: "file:src/gone.py", type: "imports", direction: "forward", weight: 0.5 },
      ],
    });
    const { assembled, stderr } = runMerge();
    expect(assembled.edges).toHaveLength(0);
    expect(stderr).toContain("missing target 'file:src/gone.py'");
  });
});

describe("merge-batch-graphs.py — nodes without IDs (unfixable)", () => {
  it("reports nodes with no id field in the could-not-fix section and excludes them from output", () => {
    writeBatch(0, {
      nodes: [
        fileNode("src/a.py"),
        { type: "file", name: "no-id.py", filePath: "src/no-id.py", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [],
    });
    const { assembled, stderr } = runMerge();
    // The no-id node is excluded.
    expect(assembled.nodes).toHaveLength(1);
    expect(assembled.nodes[0].id).toBe("file:src/a.py");
    expect(stderr).toContain("Could not fix");
    expect(stderr).toMatch(/Node\[\d+\] has no 'id' field/);
  });
});

describe("merge-batch-graphs.py — ID normalization", () => {
  it("strips double prefixes: file:file:src/a.py → file:src/a.py", () => {
    writeBatch(0, {
      nodes: [{ id: "file:file:src/a.py", type: "file", name: "a.py", filePath: "src/a.py", summary: "", tags: [], complexity: "simple" }],
      edges: [],
    });
    const { assembled, stderr } = runMerge();
    expect(assembled.nodes[0].id).toBe("file:src/a.py");
    expect(stderr).toContain("double prefix");
  });

  it("strips project-name prefixes: my-project:file:src/a.py → file:src/a.py", () => {
    writeBatch(0, {
      nodes: [{ id: "my-project:file:src/a.py", type: "file", name: "a.py", filePath: "src/a.py", summary: "", tags: [], complexity: "simple" }],
      edges: [],
    });
    const { assembled, stderr } = runMerge();
    expect(assembled.nodes[0].id).toBe("file:src/a.py");
    expect(stderr).toContain("project-name prefix");
  });

  it("canonicalizes legacy func: prefix to function:", () => {
    writeBatch(0, {
      nodes: [
        fileNode("src/a.py"),
        { id: "func:src/a.py:myFunc", type: "function", name: "myFunc", filePath: "src/a.py", summary: "", tags: [], complexity: "simple" },
      ],
      edges: [],
    });
    const { assembled, stderr } = runMerge();
    const fn = assembled.nodes.find((n) => n.name === "myFunc");
    expect(fn.id).toBe("function:src/a.py:myFunc");
    expect(stderr).toContain("func: → function:");
  });
});

describe("merge-batch-graphs.py — complexity normalization", () => {
  it("maps alias values (low, medium, high) to canonical (simple, moderate, complex)", () => {
    writeBatch(0, {
      nodes: [
        { id: "file:src/a.py", type: "file", name: "a.py", filePath: "src/a.py", summary: "", tags: [], complexity: "low" },
        { id: "file:src/b.py", type: "file", name: "b.py", filePath: "src/b.py", summary: "", tags: [], complexity: "medium" },
        { id: "file:src/c.py", type: "file", name: "c.py", filePath: "src/c.py", summary: "", tags: [], complexity: "high" },
      ],
      edges: [],
    });
    const { assembled } = runMerge();
    const byId = Object.fromEntries(assembled.nodes.map((n) => [n.id, n]));
    expect(byId["file:src/a.py"].complexity).toBe("simple");
    expect(byId["file:src/b.py"].complexity).toBe("moderate");
    expect(byId["file:src/c.py"].complexity).toBe("complex");
  });

  it("defaults unrecognized complexity strings to moderate and reports them", () => {
    writeBatch(0, {
      nodes: [
        { id: "file:src/x.py", type: "file", name: "x.py", filePath: "src/x.py", summary: "", tags: [], complexity: "banana" },
      ],
      edges: [],
    });
    const { assembled, stderr } = runMerge();
    expect(assembled.nodes[0].complexity).toBe("moderate");
    expect(stderr).toContain("Could not fix");
    expect(stderr).toContain("banana");
  });
});

describe("merge-batch-graphs.py imports recovery", () => {
  it("recovers imports edges that batches dropped despite importMap having them", () => {
    // Batch contains all the file nodes but only emits ONE of three imports edges.
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py"), fileNode("src/b.py"), fileNode("src/c.py"), fileNode("src/d.py")],
        edges: [importsEdge("src/a.py", "src/b.py")],
      }),
    );
    // scan-result.json has the full importMap — agent dropped 2/3 of these.
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: {
          "src/a.py": ["src/b.py", "src/c.py", "src/d.py"],
          "src/b.py": [],
        },
      }),
    );

    const { assembled, stderr } = runMerge();
    const importsEdges = assembled.edges.filter((e) => e.type === "imports");
    expect(importsEdges).toHaveLength(3);
    const targets = new Set(importsEdges.map((e) => e.target));
    expect(targets).toEqual(new Set(["file:src/b.py", "file:src/c.py", "file:src/d.py"]));
    // Recovered edges are tagged so downstream consumers can audit.
    const recovered = importsEdges.filter((e) => e.recoveredFromImportMap);
    expect(recovered).toHaveLength(2);
    expect(stderr).toContain("Recovered 2 `imports` edges");
  });

  it("does not duplicate edges the batch already emitted", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py"), fileNode("src/b.py")],
        edges: [importsEdge("src/a.py", "src/b.py")],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/a.py": ["src/b.py"], "src/b.py": [] },
      }),
    );

    const { assembled, stderr } = runMerge();
    const importsEdges = assembled.edges.filter((e) => e.type === "imports");
    expect(importsEdges).toHaveLength(1);
    expect(stderr).toContain("Recovered 0 `imports` edges");
  });

  it("skips importMap entries whose source file is missing from the graph", () => {
    // src/missing.py is in importMap but has no file: node — must not produce a dangling edge.
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/b.py")],
        edges: [],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/missing.py": ["src/b.py"] },
      }),
    );

    const { assembled, stderr } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(0);
    expect(stderr).toContain("Skipped 1 importMap source files with no `file:` node");
  });

  it("skips importMap targets that don't have a file: node", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py")],
        edges: [],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/a.py": ["src/dropped.py", "src/also-missing.py"] },
      }),
    );

    const { assembled, stderr } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(0);
    expect(stderr).toContain("Skipped 2 importMap target paths with no `file:` node");
  });

  it("works when scan-result.json is missing (incremental update path)", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py"), fileNode("src/b.py")],
        edges: [importsEdge("src/a.py", "src/b.py")],
      }),
    );
    // No scan-result.json written.

    const { assembled, stderr } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(1);
    expect(stderr).toContain("importMap recovery skipped — scan-result.json not found");
  });

  it("never produces self-import edges", () => {
    writeFileSync(
      join(intermediateDir, "batch-0.json"),
      JSON.stringify({
        nodes: [fileNode("src/a.py")],
        edges: [],
      }),
    );
    writeFileSync(
      join(intermediateDir, "scan-result.json"),
      JSON.stringify({
        importMap: { "src/a.py": ["src/a.py"] }, // pathological self-reference
      }),
    );

    const { assembled } = runMerge();
    expect(assembled.edges.filter((e) => e.type === "imports")).toHaveLength(0);
  });
});
