import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveMeta, loadMeta, loadDomainGraph } from "../persistence/index.js";
import type { AnalysisMeta } from "../types.js";

const testRoot = join(tmpdir(), "ua-domain-stale-flag-test");

describe("domainGraphStale flag cycle", () => {
  beforeEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true });
  });

  it("sets domainGraphStale: true on meta when domain graph is out of sync", () => {
    // Simulate: domain-graph.json exists with old commit hash
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });
    const staleDomainGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: "oldCommit123",
      },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    };
    writeFileSync(
      join(domainGraphDir, "domain-graph.json"),
      JSON.stringify(staleDomainGraph, null, 2),
      "utf-8",
    );

    // Simulate: new analysis completes with a different (newer) commit hash
    const newMeta: AnalysisMeta = {
      lastAnalyzedAt: new Date().toISOString(),
      gitCommitHash: "newCommit456",
      version: "1.0.0",
      analyzedFiles: 10,
    };

    // Check staleness logic: domain-graph.gitCommitHash (oldCommit123) != newMeta.gitCommitHash (newCommit456)
    // → domainGraphStale should be set to true
    const domainCommit = staleDomainGraph.project.gitCommitHash;
    const isStale = domainCommit !== newMeta.gitCommitHash;
    expect(isStale).toBe(true);

    // Write meta with the staleness flag
    const metaWithFlag: AnalysisMeta = {
      ...newMeta,
      domainGraphStale: isStale,
    };
    saveMeta(testRoot, metaWithFlag);

    const savedMeta = loadMeta(testRoot);
    expect(savedMeta).not.toBeNull();
    expect(savedMeta!.domainGraphStale).toBe(true);
  });

  it("does NOT set domainGraphStale when domain graph is in sync", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });
    const currentCommit = "sameCommit123";
    const domainGraph = {
      version: "1.0.0",
      project: {
        name: "test",
        languages: ["typescript"],
        frameworks: [],
        description: "test",
        analyzedAt: "2026-04-01T00:00:00.000Z",
        gitCommitHash: currentCommit,
      },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    };
    writeFileSync(
      join(domainGraphDir, "domain-graph.json"),
      JSON.stringify(domainGraph, null, 2),
      "utf-8",
    );

    const newMeta: AnalysisMeta = {
      lastAnalyzedAt: new Date().toISOString(),
      gitCommitHash: currentCommit, // Same commit
      version: "1.0.0",
      analyzedFiles: 10,
    };

    const domainCommit = domainGraph.project.gitCommitHash;
    const isStale = domainCommit !== newMeta.gitCommitHash;
    expect(isStale).toBe(false);

    const metaWithFlag: AnalysisMeta = {
      ...newMeta,
      domainGraphStale: isStale,
    };
    saveMeta(testRoot, metaWithFlag);

    const savedMeta = loadMeta(testRoot);
    expect(savedMeta).not.toBeNull();
    expect(savedMeta!.domainGraphStale).toBe(false);
  });

  it("clears domainGraphStale flag after successful /grasp-domain run", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });

    // Pre-condition: meta.json has domainGraphStale: true
    const staleMeta: AnalysisMeta = {
      lastAnalyzedAt: new Date().toISOString(),
      gitCommitHash: "newCommit456",
      version: "1.0.0",
      analyzedFiles: 10,
      domainGraphStale: true,
    };
    saveMeta(testRoot, staleMeta);

    const preClear = loadMeta(testRoot);
    expect(preClear!.domainGraphStale).toBe(true);

    // Simulate: /grasp-domain runs successfully and clears the flag
    const clearedMeta: AnalysisMeta = {
      ...preClear!,
      domainGraphStale: false,
    };
    saveMeta(testRoot, clearedMeta);

    const postClear = loadMeta(testRoot);
    expect(postClear!.domainGraphStale).toBe(false);
  });

  it("meta without domainGraphStale is treated as false (field absent)", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });

    // Write meta without domainGraphStale field
    const metaWithoutFlag: AnalysisMeta = {
      lastAnalyzedAt: new Date().toISOString(),
      gitCommitHash: "abc123",
      version: "1.0.0",
      analyzedFiles: 5,
    };
    saveMeta(testRoot, metaWithoutFlag);

    const loaded = loadMeta(testRoot);
    expect(loaded).not.toBeNull();
    // Field is absent → should be undefined, falsy for "is stale" check
    expect(loaded!.domainGraphStale).toBeUndefined();
  });

  it("no domain-graph.json means domain graph is fresh (no staleness check)", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });
    // Intentionally no domain-graph.json written

    const domainGraphPath = join(domainGraphDir, "domain-graph.json");
    const exists = existsSync(domainGraphPath);
    expect(exists).toBe(false);
    // When domain-graph.json does not exist, skip staleness check entirely
  });

  it("throws JSON parse error on malformed domain-graph.json (invalid JSON) — no validation occurs", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });
    writeFileSync(join(domainGraphDir, "domain-graph.json"), "not valid json", "utf-8");

    // JSON.parse throws before any validation can occur
    // The caller must wrap in try-catch to skip the staleness check gracefully
    expect(() => loadDomainGraph(testRoot)).toThrow();
    expect(() => loadDomainGraph(testRoot)).toThrow(/Unexpected token|not valid JSON/);
  });

  it("throws Error when domain-graph.json is missing project.gitCommitHash (validation fails)", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });
    writeFileSync(
      join(domainGraphDir, "domain-graph.json"),
      JSON.stringify({ nodes: [], edges: [], project: { name: "test" } }),
      "utf-8",
    );

    // Valid JSON but missing required gitCommitHash field → validation fails
    // Throws "Invalid domain graph" because validateGraph returns success: false
    expect(() => loadDomainGraph(testRoot)).toThrow(/Invalid domain graph/);
  });

  it("returns raw data when domain-graph.json is missing project.gitCommitHash (validate: false bypasses schema check)", () => {
    const domainGraphDir = join(testRoot, ".grasp-it");
    mkdirSync(domainGraphDir, { recursive: true });
    writeFileSync(
      join(domainGraphDir, "domain-graph.json"),
      JSON.stringify({ nodes: [], edges: [], project: { name: "test" } }),
      "utf-8",
    );

    // With validate: false, loadDomainGraph skips schema validation
    // Returns the raw parsed object — caller can safely check for absence of gitCommitHash
    const result = loadDomainGraph(testRoot, { validate: false });
    expect(result).not.toBeNull();
    expect(result!.project.gitCommitHash).toBeUndefined();
  });
});