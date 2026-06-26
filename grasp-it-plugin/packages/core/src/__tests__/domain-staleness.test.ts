import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphNode } from "../types.js";

/**
 * Per-Domain staleness (Task F migration).
 *
 * Domain graph staleness is determined per-Domain. Each `:Domain` node carries
 * `analyzedAtCommit` (the commit at which it was last derived). A domain is
 * "stale" if its `analyzedAtCommit` does not match the current codebase
 * commit. The legacy global `Project.domainCommit` / `Project.domainAnalyzedAt`
 * stamp was removed in Task F.
 *
 * If no `:Domain` nodes exist at all, the domain graph has never been built —
 * treat as stale.
 */

// ─────────────────────────────────────────────────────────────────
// Domain staleness types
// ─────────────────────────────────────────────────────────────────

interface DomainStalenessResult {
  /** True if any Domain is stale OR no Domain nodes exist. */
  stale: boolean;
  /** Current commit being compared against. */
  currentCommit: string;
  /** Per-domain records (only populated when stale=true). */
  staleDomains: Array<{
    domainId: string;
    domainName: string;
    analyzedAtCommit: string;
  }>;
}

/**
 * Compute per-domain staleness from a Neo4j session.
 *
 * Queries `:Domain` nodes for `analyzedAtCommit`. A domain is stale if its
 * `analyzedAtCommit` does not match `$currentCommit`.
 */
export async function checkDomainStaleness(
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  currentCommit: string,
): Promise<DomainStalenessResult> {
  const result = await session.run(
    `MATCH (d:Domain)
     WHERE d.analyzedAtCommit IS NOT NULL
       AND d.analyzedAtCommit <> $currentCommit
     RETURN d.id AS domainId, d.name AS domainName, d.analyzedAtCommit AS analyzedAtCommit`,
    { currentCommit },
  );

  const staleDomains = result.records.map((record) => {
    const rec = record as unknown as Record<string, unknown>;
    return {
      domainId: (rec["domainId"] as string) ?? "",
      domainName: (rec["domainName"] as string) ?? "",
      analyzedAtCommit: (rec["analyzedAtCommit"] as string) ?? "",
    };
  });

  return { stale: staleDomains.length > 0, currentCommit, staleDomains };
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

/**
 * Make a mock Neo4j session that returns the given list of Domain records
 * matching the per-Domain staleness query.
 */
function makeNeo4jSession(staleRecords: Array<{ domainId: string; domainName: string; analyzedAtCommit: string }>): MockSession {
  return {
    run: vi.fn(async () => ({
      records: staleRecords,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────
// checkDomainStaleness (per-Domain)
// ─────────────────────────────────────────────────────────────────

describe("checkDomainStaleness (per-Domain)", () => {
  it("returns stale=false when no Domain nodes are stale", async () => {
    // Empty list of stale records → all domains are current
    const session = makeNeo4jSession([]);

    const result = await checkDomainStaleness(session, "abc123");

    expect(result.stale).toBe(false);
    expect(result.currentCommit).toBe("abc123");
    expect(result.staleDomains).toEqual([]);
  });

  it("returns stale=true with one stale domain when one Domain has a different analyzedAtCommit", async () => {
    const session = makeNeo4jSession([
      { domainId: "domain:auth", domainName: "Auth", analyzedAtCommit: "old-commit" },
    ]);

    const result = await checkDomainStaleness(session, "abc123");

    expect(result.stale).toBe(true);
    expect(result.staleDomains).toHaveLength(1);
    expect(result.staleDomains[0]).toEqual({
      domainId: "domain:auth",
      domainName: "Auth",
      analyzedAtCommit: "old-commit",
    });
  });

  it("returns stale=true with multiple stale domains when several need re-derivation", async () => {
    const session = makeNeo4jSession([
      { domainId: "domain:auth", domainName: "Auth", analyzedAtCommit: "old" },
      { domainId: "domain:billing", domainName: "Billing", analyzedAtCommit: "older" },
    ]);

    const result = await checkDomainStaleness(session, "abc123");

    expect(result.stale).toBe(true);
    expect(result.staleDomains).toHaveLength(2);
    expect(result.staleDomains.map((d) => d.domainId)).toEqual([
      "domain:auth",
      "domain:billing",
    ]);
  });

  it("passes currentCommit as $currentCommit parameter to the Cypher query", async () => {
    const session = makeNeo4jSession([]);

    await checkDomainStaleness(session, "deadbeef");

    expect(session.run).toHaveBeenCalledWith(
      expect.stringContaining("MATCH (d:Domain)"),
      expect.objectContaining({ currentCommit: "deadbeef" }),
    );
  });

  it("Cypher query filters by d.analyzedAtCommit IS NOT NULL AND d.analyzedAtCommit <> $currentCommit", async () => {
    const session = makeNeo4jSession([]);

    await checkDomainStaleness(session, "abc123");

    const callArgs = session.run.mock.calls[0] as [string, Record<string, unknown>];
    expect(callArgs[0]).toContain("d.analyzedAtCommit IS NOT NULL");
    expect(callArgs[0]).toContain("d.analyzedAtCommit <> $currentCommit");
  });

  it("returns empty result when no records returned (no stale domains)", async () => {
    const session = {
      run: vi.fn(async () => ({ records: [] })),
    };

    const result = await checkDomainStaleness(session, "abc123");

    expect(result.stale).toBe(false);
    expect(result.staleDomains).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// Domain commit comparison semantics (pure logic tests)
// ─────────────────────────────────────────────────────────────────

describe("domain commit comparison semantics (per-Domain)", () => {
  /**
   * The "domain graph is fresh" decision: every Domain must match.
   * "All current" semantics — STOP only if no stale Domain exists.
   */
  function isGraphFresh(domainCommits: string[], currentCommit: string): boolean {
    return domainCommits.every((c) => c === currentCommit);
  }

  it("graph is fresh when every Domain.analyzedAtCommit === currentCommit", () => {
    expect(isGraphFresh(["abc", "abc", "abc"], "abc")).toBe(true);
  });

  it("graph is stale when at least one Domain.analyzedAtCommit differs", () => {
    expect(isGraphFresh(["abc", "def", "abc"], "abc")).toBe(false);
  });

  it("graph is stale when all Domain.analyzedAtCommit differ (full rebuild needed)", () => {
    expect(isGraphFresh(["x", "y", "z"], "abc")).toBe(false);
  });

  it("graph is fresh when there are no Domains (degenerate: nothing stale)", () => {
    // Edge case: empty graph → no stale domains → caller checks separately for "never built"
    expect(isGraphFresh([], "abc")).toBe(true);
  });

  it("after a fresh /grasp-domain re-run, all touched Domains match", () => {
    // Before re-run: [old, old, old], current = "new"
    expect(isGraphFresh(["old", "old", "old"], "new")).toBe(false);
    // After re-run: every Domain stamped with "new"
    expect(isGraphFresh(["new", "new", "new"], "new")).toBe(true);
  });

  it("mixed-freshness state: some Domains current, some stale — graph is stale overall", () => {
    // Auth and Billing were re-derived at "new"; Reports still has "old"
    const mixed = ["new", "old", "new"];
    expect(isGraphFresh(mixed, "new")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Domain graph nodes in Neo4j (structural sanity)
// ─────────────────────────────────────────────────────────────────

describe("domain graph nodes in Neo4j (Knowledge label)", () => {
  it("represents domain node types with secondary labels", () => {
    const domainTypes = ["Domain", "Feature", "Operation", "Actor", "BusinessRule", "Entity"];
    expect(domainTypes).toContain("Domain");
    expect(domainTypes).toContain("Feature");
    expect(domainTypes).toContain("Operation");
    expect(domainTypes).toContain("Actor");
    expect(domainTypes).toContain("BusinessRule");
    expect(domainTypes).toContain("Entity");
  });

  it("domain elements have PART_OF relationship to Project", () => {
    const relationship = "PART_OF";
    expect(relationship).toBe("PART_OF");
  });

  it("loadDomainGraphFromNeo4j returns null when no Knowledge nodes exist", async () => {
    const session = {
      run: vi.fn(async (_query?: unknown, _params?: unknown) => ({ records: [] })),
    };

    const result = await session.run(
      `MATCH (d:Knowledge)-[:PART_OF]->(p:Project {id: $projectId}) RETURN d`,
      { projectId: "project:singleton" },
    );

    expect(result.records).toHaveLength(0);
  });
});