import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "../../skills/grasp/merge-subdomain-graphs.py");

let projectRoot;
let graspDir;

function runScript(...extraArgs) {
  return spawnSync("python3", [SCRIPT, projectRoot, ...extraArgs], {
    encoding: "utf-8",
  });
}

function readOutput() {
  return JSON.parse(readFileSync(join(graspDir, "knowledge-graph.json"), "utf-8"));
}

function makeGraph(overrides = {}) {
  return {
    version: "1.0.0",
    project: { name: "test", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
    ...overrides,
  };
}

function makeNode(id, type = "module", extra = {}) {
  return { id, type, name: id, summary: "", tags: [], ...extra };
}

function makeEdge(source, target, type = "imports", weight = 0.5) {
  return { source, target, type, weight };
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "merge-subdomain-test-"));
  graspDir = join(projectRoot, ".grasp-it");
  mkdirSync(graspDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("merge-subdomain-graphs.py", () => {
  // ── Test 1: Basic merge ─────────────────────────────────────────────────────
  it("merges two graphs with node deduplication (last wins) and edge deduplication", () => {
    const graph1 = makeGraph({
      nodes: [makeNode("node-a"), makeNode("node-b", "module", { summary: "first" })],
      edges: [makeEdge("node-a", "node-b")],
    });
    const graph2 = makeGraph({
      nodes: [makeNode("node-b", "module", { summary: "second" }), makeNode("node-c")],
      edges: [makeEdge("node-b", "node-c")],
    });

    const f1 = join(graspDir, "auth-knowledge-graph.json");
    const f2 = join(graspDir, "billing-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(graph1));
    writeFileSync(f2, JSON.stringify(graph2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    const out = readOutput();
    expect(out.nodes).toHaveLength(3); // node-a, node-b (deduped), node-c
    const nodeB = out.nodes.find((n) => n.id === "node-b");
    expect(nodeB.summary).toBe("second"); // last wins
    expect(out.edges).toHaveLength(2);
  });

  // ── Test 2: Edge deduplication keeps higher weight ──────────────────────────
  it("keeps the higher-weight edge when deduplicating (handles string weights via _num coercion)", () => {
    const graph1 = makeGraph({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("a", "b", "calls", 0.3)],
    });
    const graph2 = makeGraph({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [makeEdge("a", "b", "calls", 0.9)],
    });
    const graph3 = makeGraph({
      nodes: [makeNode("a"), makeNode("b")],
      edges: [{ source: "a", target: "b", type: "calls", weight: "0.5" }], // string weight
    });

    const f1 = join(graspDir, "g1-knowledge-graph.json");
    const f2 = join(graspDir, "g2-knowledge-graph.json");
    const f3 = join(graspDir, "g3-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(graph1));
    writeFileSync(f2, JSON.stringify(graph2));
    writeFileSync(f3, JSON.stringify(graph3));

    const result = runScript(f1, f2, f3);
    expect(result.status).toBe(0);

    const out = readOutput();
    expect(out.edges).toHaveLength(1);
    // The edge with weight 0.9 should win
    expect(out.edges[0].weight).toBe(0.9);
  });

  // ── Test 3: Edges referencing missing nodes are dropped ─────────────────────
  it("drops edges that reference missing nodes", () => {
    const graph = makeGraph({
      nodes: [makeNode("x"), makeNode("y")],
      edges: [
        makeEdge("x", "y"),          // valid
        makeEdge("x", "ghost"),      // ghost target doesn't exist
        makeEdge("phantom", "y"),    // phantom source doesn't exist
      ],
    });

    const f = join(graspDir, "sub-knowledge-graph.json");
    writeFileSync(f, JSON.stringify(graph));

    const result = runScript(f);
    expect(result.status).toBe(0);

    const out = readOutput();
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ source: "x", target: "y" });
    expect(result.stderr).toContain("ghost");
    expect(result.stderr).toContain("phantom");
  });

  // ── Test 4: Layer merging — union nodeIds, drop dangling refs ───────────────
  it("merges layers by id (union nodeIds) and drops dangling layer nodeId refs", () => {
    const graph1 = makeGraph({
      nodes: [makeNode("n1"), makeNode("n2")],
      edges: [],
      layers: [{ id: "layer-api", name: "API", nodeIds: ["n1", "dangling1"] }],
    });
    const graph2 = makeGraph({
      nodes: [makeNode("n3")],
      edges: [],
      layers: [
        { id: "layer-api", name: "API", nodeIds: ["n2", "n3"] },
        { id: "layer-db", name: "DB", nodeIds: ["n3", "dangling2"] },
      ],
    });

    const f1 = join(graspDir, "a-knowledge-graph.json");
    const f2 = join(graspDir, "b-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(graph1));
    writeFileSync(f2, JSON.stringify(graph2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    const out = readOutput();
    expect(out.layers).toHaveLength(2);

    const apiLayer = out.layers.find((l) => l.id === "layer-api");
    expect(apiLayer).toBeDefined();
    // n1, n2, n3 unioned; dangling1 dropped
    expect(new Set(apiLayer.nodeIds)).toEqual(new Set(["n1", "n2", "n3"]));

    const dbLayer = out.layers.find((l) => l.id === "layer-db");
    expect(dbLayer).toBeDefined();
    // dangling2 dropped
    expect(dbLayer.nodeIds).toEqual(["n3"]);
  });

  // ── Test 5: Tour step merging ───────────────────────────────────────────────
  it("merges tour steps with same title: unions nodeIds, keeps longer description, renumbers", () => {
    const graph1 = makeGraph({
      nodes: [makeNode("n1"), makeNode("n2")],
      edges: [],
      tour: [
        { order: 1, title: "Overview", description: "Short desc", nodeIds: ["n1"] },
        { order: 2, title: "Details", description: "Some details", nodeIds: ["n2"] },
      ],
    });
    const graph2 = makeGraph({
      nodes: [makeNode("n3")],
      edges: [],
      tour: [
        { order: 1, title: "Overview", description: "A much longer description here", nodeIds: ["n3"] },
        { order: 2, title: "Extra Step", description: "New step", nodeIds: ["n3"] },
      ],
    });

    const f1 = join(graspDir, "p1-knowledge-graph.json");
    const f2 = join(graspDir, "p2-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(graph1));
    writeFileSync(f2, JSON.stringify(graph2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    const out = readOutput();
    // Overview (merged), Details, Extra Step = 3 steps
    expect(out.tour).toHaveLength(3);

    const overview = out.tour.find((s) => s.title === "Overview");
    expect(overview).toBeDefined();
    expect(overview.description).toBe("A much longer description here"); // longer wins
    expect(new Set(overview.nodeIds)).toEqual(new Set(["n1", "n3"])); // unioned

    // Steps renumbered sequentially
    const orders = out.tour.map((s) => s.order).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3]);
  });

  // ── Test 6: Auto-discovery ──────────────────────────────────────────────────
  it("auto-discovers *knowledge-graph*.json files, skipping knowledge-graph.json itself", () => {
    const sub1 = makeGraph({ nodes: [makeNode("auto-n1")], edges: [] });
    const sub2 = makeGraph({ nodes: [makeNode("auto-n2")], edges: [] });
    // This file should NOT be discovered (it's the output file name)
    const mainGraph = makeGraph({ nodes: [makeNode("main-node")], edges: [] });

    writeFileSync(join(graspDir, "auth-knowledge-graph.json"), JSON.stringify(sub1));
    writeFileSync(join(graspDir, "billing-knowledge-graph.json"), JSON.stringify(sub2));
    writeFileSync(join(graspDir, "knowledge-graph.json"), JSON.stringify(mainGraph));

    // Run without explicit files — should auto-discover
    const result = runScript();
    expect(result.status).toBe(0);

    const out = readOutput();
    const ids = out.nodes.map((n) => n.id);
    expect(ids).toContain("auto-n1");
    expect(ids).toContain("auto-n2");
    // main-node came from the base graph loaded separately, so it may be present
    // but auth/billing nodes must be present
  });

  // ── Test 7: Base graph loading — subdomains win on conflict ─────────────────
  it("loads existing knowledge-graph.json as base; subdomain data wins on node conflict", () => {
    const baseGraph = makeGraph({
      nodes: [makeNode("shared-node", "module", { summary: "base summary" })],
      edges: [],
    });
    const subGraph = makeGraph({
      nodes: [makeNode("shared-node", "module", { summary: "subdomain summary" }), makeNode("new-node")],
      edges: [],
    });

    // Write base as existing output
    writeFileSync(join(graspDir, "knowledge-graph.json"), JSON.stringify(baseGraph));
    // Write subdomain file
    const subFile = join(graspDir, "sub-knowledge-graph.json");
    writeFileSync(subFile, JSON.stringify(subGraph));

    const result = runScript(subFile);
    expect(result.status).toBe(0);

    const out = readOutput();
    const shared = out.nodes.find((n) => n.id === "shared-node");
    expect(shared).toBeDefined();
    // Subdomain wins (inserted after base, so later occurrence overwrites)
    expect(shared.summary).toBe("subdomain summary");
    expect(out.nodes.some((n) => n.id === "new-node")).toBe(true);
  });

  // ── Test 8: Invalid JSON file is skipped ────────────────────────────────────
  it("skips invalid JSON files with a warning and still succeeds if valid files remain", () => {
    const validGraph = makeGraph({ nodes: [makeNode("valid-node")], edges: [] });
    const validFile = join(graspDir, "valid-knowledge-graph.json");
    const invalidFile = join(graspDir, "broken-knowledge-graph.json");

    writeFileSync(validFile, JSON.stringify(validGraph));
    writeFileSync(invalidFile, "{ this is not valid json !!!");

    const result = runScript(validFile, invalidFile);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Skipping broken-knowledge-graph.json");

    const out = readOutput();
    expect(out.nodes.some((n) => n.id === "valid-node")).toBe(true);
  });

  // ── Test 9: Missing nodes/edges array is skipped ─────────────────────────────
  it("skips files missing required nodes or edges arrays", () => {
    const badGraph = { version: "1.0.0", project: {} }; // no nodes/edges
    const goodGraph = makeGraph({ nodes: [makeNode("good-node")], edges: [] });

    const badFile = join(graspDir, "bad-knowledge-graph.json");
    const goodFile = join(graspDir, "good-knowledge-graph.json");
    writeFileSync(badFile, JSON.stringify(badGraph));
    writeFileSync(goodFile, JSON.stringify(goodGraph));

    const result = runScript(badFile, goodFile);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("missing nodes or edges array");

    const out = readOutput();
    expect(out.nodes.some((n) => n.id === "good-node")).toBe(true);
  });

  // ── Test 10: No files to merge (auto-discover finds nothing) → exit 0 ────────
  it("exits 0 with a message when auto-discovery finds no subdomain graphs", () => {
    // .grasp-it exists but has no *knowledge-graph*.json files (only unrelated files)
    writeFileSync(join(graspDir, "scan-result.json"), JSON.stringify({}));

    const result = runScript();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No subdomain graphs found");
  });

  // ── Test 11: Missing .grasp-it dir → exit 1 ─────────────────────────────────
  it("exits 1 when .grasp-it directory does not exist", () => {
    // Use a project root that has no .grasp-it dir
    const emptyRoot = mkdtempSync(join(tmpdir(), "merge-no-grasp-"));
    try {
      const result = spawnSync("python3", [SCRIPT, emptyRoot], { encoding: "utf-8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(".grasp-it");
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  // ── Test 12: Explicit file list — no auto-discovery ─────────────────────────
  it("uses only explicit files when provided, ignoring other *knowledge-graph*.json in .grasp-it", () => {
    const explicitGraph = makeGraph({ nodes: [makeNode("explicit-node")], edges: [] });
    const ignoredGraph = makeGraph({ nodes: [makeNode("ignored-node")], edges: [] });

    const explicitFile = join(graspDir, "explicit-knowledge-graph.json");
    const ignoredFile = join(graspDir, "ignored-knowledge-graph.json");
    writeFileSync(explicitFile, JSON.stringify(explicitGraph));
    writeFileSync(ignoredFile, JSON.stringify(ignoredGraph));

    const result = runScript(explicitFile); // only pass one file explicitly
    expect(result.status).toBe(0);

    const out = readOutput();
    expect(out.nodes.some((n) => n.id === "explicit-node")).toBe(true);
    expect(out.nodes.some((n) => n.id === "ignored-node")).toBe(false);
  });

  // ── Test 13: Project metadata merging ───────────────────────────────────────
  it("unions languages/frameworks, concatenates unique descriptions, keeps latest analyzedAt", () => {
    const g1 = makeGraph({
      nodes: [makeNode("m1")],
      edges: [],
      project: {
        name: "my-project",
        languages: ["TypeScript", "Python"],
        frameworks: ["React"],
        description: "Frontend service",
        analyzedAt: "2024-01-01T10:00:00Z",
        gitCommitHash: "abc123",
      },
    });
    const g2 = makeGraph({
      nodes: [makeNode("m2")],
      edges: [],
      project: {
        name: "my-project",
        languages: ["Python", "Go"],
        frameworks: ["Express", "React"],
        description: "Backend service",
        analyzedAt: "2024-02-01T10:00:00Z",
        gitCommitHash: "def456",
      },
    });

    const f1 = join(graspDir, "fe-knowledge-graph.json");
    const f2 = join(graspDir, "be-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(g1));
    writeFileSync(f2, JSON.stringify(g2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    const out = readOutput();
    const proj = out.project;

    // Languages unioned (no duplicates)
    expect(new Set(proj.languages)).toEqual(new Set(["TypeScript", "Python", "Go"]));
    // Frameworks unioned (no duplicates)
    expect(new Set(proj.frameworks)).toEqual(new Set(["React", "Express"]));
    // Descriptions concatenated with " | "
    expect(proj.description).toBe("Frontend service | Backend service");
    // Latest analyzedAt wins
    expect(proj.analyzedAt).toBe("2024-02-01T10:00:00Z");
    // With different commit hashes across subdomains, the oldest by analyzedAt is used
    // (git merge-base falls back to analyzedAt comparison since the temp dir is not a git repo)
    expect(proj.gitCommitHash).toBe("abc123");
  });

  // ── Test 14: Staleness detection — different commits emit warning and use oldest hash ──
  it("emits warning and uses oldest hash when subdomain graphs have different git commits", () => {
    const g1 = makeGraph({
      nodes: [makeNode("n1")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "First subdomain",
        analyzedAt: "2024-01-01T10:00:00Z",
        gitCommitHash: "aaa111",
      },
    });
    const g2 = makeGraph({
      nodes: [makeNode("n2")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "Second subdomain",
        analyzedAt: "2024-01-02T10:00:00Z",
        gitCommitHash: "bbb222",
      },
    });
    const g3 = makeGraph({
      nodes: [makeNode("n3")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "Third subdomain",
        analyzedAt: "2024-01-03T10:00:00Z",
        gitCommitHash: "ccc333",
      },
    });

    const f1 = join(graspDir, "sub1-knowledge-graph.json");
    const f2 = join(graspDir, "sub2-knowledge-graph.json");
    const f3 = join(graspDir, "sub3-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(g1));
    writeFileSync(f2, JSON.stringify(g2));
    writeFileSync(f3, JSON.stringify(g3));

    const result = runScript(f1, f2, f3);
    expect(result.status).toBe(0);

    const out = readOutput();

    // Warning should be emitted about different commits
    expect(result.stderr).toContain("Warning: subdomain graphs were built at different commits:");
    expect(result.stderr).toContain("aaa111");
    expect(result.stderr).toContain("bbb222");
    expect(result.stderr).toContain("ccc333");
    expect(result.stderr).toContain("aaa111");

    // The oldest commit by analyzedAt should be used as canonical hash
    expect(out.project.gitCommitHash).toBe("aaa111");
    // analyzedAt should still be the latest
    expect(out.project.analyzedAt).toBe("2024-01-03T10:00:00Z");
  });

  // ── Test 15: Single commit hash — no warning ─────────────────────────────────
  it("does not emit warning when all subdomain graphs have the same git commit hash", () => {
    const g1 = makeGraph({
      nodes: [makeNode("n1")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "First subdomain",
        analyzedAt: "2024-01-01T10:00:00Z",
        gitCommitHash: "samehash",
      },
    });
    const g2 = makeGraph({
      nodes: [makeNode("n2")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "Second subdomain",
        analyzedAt: "2024-01-02T10:00:00Z",
        gitCommitHash: "samehash",
      },
    });

    const f1 = join(graspDir, "sub1-knowledge-graph.json");
    const f2 = join(graspDir, "sub2-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(g1));
    writeFileSync(f2, JSON.stringify(g2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    // No staleness warning should be emitted
    expect(result.stderr).not.toContain("Warning: subdomain graphs were built at different commits:");

    const out = readOutput();
    // Hash should be the same (since all graphs have the same hash)
    expect(out.project.gitCommitHash).toBe("samehash");
  });

  // ── Gap 4: empty/null gitCommitHash should not emit false staleness warning ──
  it("handles subdomain graph with empty gitCommitHash without emitting staleness warning", () => {
    const g1 = makeGraph({
      nodes: [makeNode("n1")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "First subdomain",
        analyzedAt: "2024-01-01T10:00:00Z",
        gitCommitHash: "abc123",
      },
    });
    // g2 has empty string gitCommitHash — should be excluded from staleness comparison
    const g2 = makeGraph({
      nodes: [makeNode("n2")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "Second subdomain",
        analyzedAt: "2024-01-02T10:00:00Z",
        gitCommitHash: "", // empty hash — should be skipped
      },
    });

    const f1 = join(graspDir, "sub1-knowledge-graph.json");
    const f2 = join(graspDir, "sub2-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(g1));
    writeFileSync(f2, JSON.stringify(g2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    // No staleness warning should be emitted (only one non-empty hash)
    expect(result.stderr).not.toContain("Warning: subdomain graphs were built at different commits:");

    const out = readOutput();
    // The resolved hash should be "abc123" (the non-empty one)
    expect(out.project.gitCommitHash).toBe("abc123");
  });

  it("handles subdomain graph with missing gitCommitHash field without emitting staleness warning", () => {
    const g1 = makeGraph({
      nodes: [makeNode("n1")],
      edges: [],
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "First subdomain",
        analyzedAt: "2024-01-01T10:00:00Z",
        gitCommitHash: "abc123",
      },
    });
    // g2 is missing gitCommitHash entirely
    const g2 = {
      version: "1.0.0",
      project: {
        name: "test-project",
        languages: ["TypeScript"],
        frameworks: [],
        description: "Second subdomain",
        analyzedAt: "2024-01-02T10:00:00Z",
        // no gitCommitHash field
      },
      nodes: [makeNode("n2")],
      edges: [],
      layers: [],
      tour: [],
    };

    const f1 = join(graspDir, "sub1-knowledge-graph.json");
    const f2 = join(graspDir, "sub2-knowledge-graph.json");
    writeFileSync(f1, JSON.stringify(g1));
    writeFileSync(f2, JSON.stringify(g2));

    const result = runScript(f1, f2);
    expect(result.status).toBe(0);

    // No staleness warning should be emitted (only one non-empty hash)
    expect(result.stderr).not.toContain("Warning: subdomain graphs were built at different commits:");

    const out = readOutput();
    expect(out.project.gitCommitHash).toBe("abc123");
  });
});
