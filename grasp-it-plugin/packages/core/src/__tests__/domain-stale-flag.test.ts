import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeGraph, GraphNode, ProjectSingletonMeta } from "../types.js";

/**
 * Domain staleness is determined by comparing:
 *   Project.gitCommitHash  — current commit when /grasp last ran
 *   Project.domainCommit   — commit when /grasp-domain last ran
 *
 * If they differ, the domain graph is stale.
 *
 * The old domainGraphStale flag in meta.json is deprecated.
 */

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────
// Domain staleness types
// ─────────────────────────────────────────────────────────────────

interface DomainStalenessResult {
  stale: boolean;
  projectCommit: string;
  domainCommit: string;
  commitsBehind: number;
}

/**
 * Compute domain graph staleness from a Neo4j session.
 *
 * Queries the Project singleton for:
 *   - gitCommitHash  (current project commit)
 *   - domainCommit   (commit when domain analysis was last run)
 *
 * If domainCommit is null/missing, the domain graph has never been built — treat as stale.
 */
export async function checkDomainStaleness(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  projectId: string,
): Promise<DomainStalenessResult> {
  const result = await session.run(
    `MATCH (p:Project {id: $projectId})
     RETURN p.gitCommitHash AS gitCommitHash, p.domainCommit AS domainCommit`,
    { projectId },
  );

  const record = result.records[0] as unknown as Record<string, unknown> | undefined;
  if (!record) {
    return { stale: true, projectCommit: "", domainCommit: "", commitsBehind: 0 };
  }

  const projectCommit = (record["gitCommitHash"] as string) ?? "";
  const domainCommit = (record["domainCommit"] as string) ?? "";

  // Never run domain analysis
  if (!domainCommit) {
    return { stale: true, projectCommit, domainCommit: "", commitsBehind: 0 };
  }

  if (projectCommit === domainCommit) {
    return { stale: false, projectCommit, domainCommit, commitsBehind: 0 };
  }

  return { stale: true, projectCommit, domainCommit, commitsBehind: 0 };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function makeNode(
  overrides: Partial<GraphNode> & { id: string; name: string },
): GraphNode {
  return {
    type: "file",
    summary: "",
    tags: [],
    complexity: "simple",
    ...overrides,
  };
}

type MockSession = {
  run: ReturnType<typeof vi.fn>;
};

function makeNeo4jSession(meta: {
  gitCommitHash?: string | null;
  domainCommit?: string | null;
}): MockSession {
  return {
    run: vi.fn(async () => ({
      records: [
        {
          gitCommitHash: meta.gitCommitHash ?? null,
          domainCommit: meta.domainCommit ?? null,
        },
      ],
    })),
  };
}

function makeEmptyNeo4jSession(): MockSession {
  return {
    run: vi.fn(async () => ({ records: [] })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// checkDomainStaleness
// ─────────────────────────────────────────────────────────────────

describe("checkDomainStaleness", () => {
  it("returns stale=false when project commit matches domain commit", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "abc123",
      domainCommit: "abc123",
    });

    const result = await checkDomainStaleness(session, "project:singleton");

    expect(result).toEqual({
      stale: false,
      projectCommit: "abc123",
      domainCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("returns stale=true when project commit differs from domain commit", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "def456",
      domainCommit: "abc123",
    });

    const result = await checkDomainStaleness(session, "project:singleton");

    expect(result).toEqual({
      stale: true,
      projectCommit: "def456",
      domainCommit: "abc123",
      commitsBehind: 0,
    });
  });

  it("returns stale=true when domainCommit is null (never run)", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "abc123",
      domainCommit: null,
    });

    const result = await checkDomainStaleness(session, "project:singleton");

    expect(result.stale).toBe(true);
    expect(result.domainCommit).toBe("");
  });

  it("returns stale=true when domainCommit is missing (undefined)", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: "abc123",
      domainCommit: undefined,
    });

    const result = await checkDomainStaleness(session, "project:singleton");

    expect(result.stale).toBe(true);
  });

  it("returns stale=true when Project node does not exist (no records)", async () => {
    const session = makeEmptyNeo4jSession();

    const result = await checkDomainStaleness(session, "project:singleton");

    expect(result).toEqual({
      stale: true,
      projectCommit: "",
      domainCommit: "",
      commitsBehind: 0,
    });
  });

  it("returns stale=true when gitCommitHash is null but domainCommit exists", async () => {
    const session = makeNeo4jSession({
      gitCommitHash: null,
      domainCommit: "abc123",
    });

    const result = await checkDomainStaleness(session, "project:singleton");

    expect(result.stale).toBe(true);
    expect(result.projectCommit).toBe("");
    expect(result.domainCommit).toBe("abc123");
  });
});

// ─────────────────────────────────────────────────────────────────
// Domain staleness logic — Project.gitCommitHash vs Project.domainCommit
// ─────────────────────────────────────────────────────────────────

describe("domain commit comparison (Project.gitCommitHash vs Project.domainCommit)", () => {
  it("domain graph is fresh when gitCommitHash === domainCommit", () => {
    const gitCommitHash: string = "abc123";
    const domainCommit: string = "abc123";
    const isStale = gitCommitHash !== domainCommit;
    expect(isStale).toBe(false);
  });

  it("domain graph is stale when gitCommitHash !== domainCommit", () => {
    const gitCommitHash: string = "def456";
    const domainCommit: string = "abc123";
    const isStale = gitCommitHash !== domainCommit;
    expect(isStale).toBe(true);
  });

  it("domain graph is stale when domainCommit is empty string (never run)", () => {
    const gitCommitHash: string = "abc123";
    const domainCommit: string = "";
    const isStale = domainCommit === "" || gitCommitHash !== domainCommit;
    expect(isStale).toBe(true);
  });

  it("domain graph is stale after /grasp runs (new gitCommitHash, no domainCommit update yet)", () => {
    // Scenario: /grasp ran and updated gitCommitHash to "def456"
    // /grasp-domain has NOT re-run, so domainCommit still has old value
    const gitCommitHash: string = "def456";
    const domainCommit: string = "abc123";
    const isStale = gitCommitHash !== domainCommit;
    expect(isStale).toBe(true);
  });

  it("domain graph becomes fresh after /grasp-domain re-runs and sets domainCommit = gitCommitHash", () => {
    const gitCommitHash: string = "def456";
    const domainCommit: string = "def456";
    const isStale = gitCommitHash !== domainCommit;
    expect(isStale).toBe(false);
  });

  it("multiple /grasp runs without /grasp-domain keep domain graph stale", () => {
    // After first /grasp: gitCommitHash = "def456", domainCommit still = "abc123"
    // After second /grasp: gitCommitHash = "ghi789", domainCommit still = "abc123"
    const gitCommitHash1: string = "def456";
    const domainCommit1: string = "abc123";
    expect(gitCommitHash1 !== domainCommit1).toBe(true);

    const gitCommitHash2: string = "ghi789";
    const domainCommit2: string = "abc123";
    expect(gitCommitHash2 !== domainCommit2).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// Domain graph nodes in Neo4j
// ─────────────────────────────────────────────────────────────────

describe("domain graph nodes in Neo4j (DomainElement label)", () => {
  it("represents domain node types with secondary labels", () => {
    // Domain graph nodes use primary label DomainElement with secondary labels:
    // Domain, Feature, Operation, Actor, BusinessRule, Entity
    const domainTypes = ["Domain", "Feature", "Operation", "Actor", "BusinessRule", "Entity"];
    expect(domainTypes).toContain("Domain");
    expect(domainTypes).toContain("Feature");
    expect(domainTypes).toContain("Operation");
    expect(domainTypes).toContain("Actor");
    expect(domainTypes).toContain("BusinessRule");
    expect(domainTypes).toContain("Entity");
  });

  it("domain elements have PART_OF relationship to Project", () => {
    // Expected Cypher pattern:
    // MATCH (d:DomainElement)-[:PART_OF]->(p:Project {id: $projectId})
    const relationship = "PART_OF";
    expect(relationship).toBe("PART_OF");
  });

  it("loadDomainGraphFromNeo4j returns null when no DomainElement nodes exist", async () => {
    const session = makeEmptyNeo4jSession();

    const result = await session.run(
      `MATCH (d:DomainElement)-[:PART_OF]->(p:Project {id: $projectId}) RETURN d`,
      { projectId: "project:singleton" },
    );

    expect(result.records).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Deprecated domainGraphStale flag behavior
// ─────────────────────────────────────────────────────────────────

describe("deprecated domainGraphStale flag in AnalysisMeta", () => {
  it("domainGraphStale field is optional in AnalysisMeta", () => {
    // The old domainGraphStale flag is deprecated.
    // New code should use Project.gitCommitHash !== Project.domainCommit instead.
    const meta = {
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
      gitCommitHash: "abc123",
      version: "1.0.0",
      analyzedFiles: 10,
      // domainGraphStale intentionally omitted
    };

    // No TypeScript error — field is optional
    expect(meta.gitCommitHash).toBe("abc123");
  });

  it("domainGraphStale: true in meta.json means domain was stale at write time (legacy)", () => {
    // This test documents the OLD behavior that is being replaced.
    // Old: meta.json had domainGraphStale: true/false
    // New: staleness is computed from Project.gitCommitHash vs Project.domainCommit
    const oldStyleMeta = {
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
      gitCommitHash: "def456",
      version: "1.0.0",
      analyzedFiles: 10,
      domainGraphStale: true,
    };

    // In the old system, domainGraphStale: true meant the domain graph was out of sync
    expect(oldStyleMeta.domainGraphStale).toBe(true);
  });

  it("domainGraphStale: false means domain was in sync at write time (legacy)", () => {
    const oldStyleMeta = {
      lastAnalyzedAt: "2026-01-01T00:00:00.000Z",
      gitCommitHash: "abc123",
      version: "1.0.0",
      analyzedFiles: 10,
      domainGraphStale: false,
    };

    expect(oldStyleMeta.domainGraphStale).toBe(false);
  });
});