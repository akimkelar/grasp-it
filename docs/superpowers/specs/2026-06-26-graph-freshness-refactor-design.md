# Graph Freshness Refactoring — Design

**Date:** 2026-06-26
**Status:** Draft (pending user approval)

## Problem

The "graph freshness check" pattern is repeated across most skills (`/grasp-diff`, `/grasp-domain`, `/grasp-search`, `/grasp-chat`, `/grasp-gaps`, `/grasp-knowledge`). It works like this:

1. Query Neo4j `Project` singleton for `gitCommitHash`.
2. Compare equality with `git rev-parse HEAD`.
3. Print a warning if they differ; continue regardless.

This is unreliable and noisy:

| Issue | Why it matters |
|-------|----------------|
| **Branch-unsafe** | Equality check fails on any branch switch or feature-branch commit, even when the graph is still valid for the common ancestor. |
| **No hierarchy awareness** | A single linear commit comparison misses that "HEAD moved past the graph commit by N commits" says nothing about *which files / nodes* actually changed. |
| **Per-domain blind** | `Project.gitCommitHash` is a global stamp; different knowledge nodes may have been derived at different times and at different freshness levels. |
| **Always-on cost** | Every skill invocation pays a Neo4j round-trip + a `git rev-parse` for a warning that is often wrong. |
| **Trust erosion** | False positives teach users to ignore the warning; false negatives give false confidence. |

Meanwhile, the per-node/per-file staleness infrastructure already exists in core (`staleness.ts`) but isn't surfaced through any skill.

## Current State (from exploration)

The infrastructure for a much better approach already exists in the codebase:

| Capability | Location | Status |
|------------|----------|--------|
| Per-`File` `analyzedAtCommit` | `core/src/types.ts:71` | Implemented |
| Per-knowledge-node `sourceCommit` | `core/src/types.ts:82` | Implemented |
| `findStaleImplementedBy()` (per-node staleness) | `core/src/staleness.ts:226` | Implemented + tested |
| `mergeGraphUpdate()` (maintains `analyzedAtCommit`) | `core/src/staleness.ts:162` | Implemented + tested |
| `checkGraphFreshness()` (for `/grasp` Phase 0) | `core/src/staleness.ts:82` | Implemented + tested |
| `checkDomainStaleness()` (for `/grasp-domain`) | `core/src/__tests__/domain-staleness.test.ts` | Implemented + tested |
| `Project` singleton | `core/src/persistence/index.ts:195-487` | Implemented |

What's missing:
- Skills that **use** `findStaleImplementedBy` to report per-domain freshness.
- A dedicated `/grasp-freshness` skill.
- A per-file scope check in `/grasp-diff` (replacing the misleading global one).
- Removal of the global freshness check from skills where it adds no value.

## Goals

1. Remove the global freshness check from every skill except `/grasp` (which has a real incremental-update purpose) and `/grasp-domain` (which has its own `domainCommit`-based staleness signal).
2. Replace `/grasp-diff`'s global check with a **scope check** that warns only about files in the diff that aren't in the graph at all, or whose `File.analyzedAtCommit` is older than the last commit that touched them.
3. Add a new `/grasp-freshness` skill that produces a per-domain staleness report using the existing `findStaleImplementedBy()` infrastructure, grouping knowledge nodes by their Domain ancestor (with `sourceFiles` directory fallback).

## Non-Goals

- **Removing the `Project` singleton.** It is still legitimately used by `/grasp` (Phase 0 incremental-update detection) and `/grasp-domain` (`domainCommit` vs `gitCommitHash`). Removing it would be a separate, larger refactor. *Decision deferred; see §Open Questions.*
- **Migrating existing knowledge nodes** to have `sourceCommit` populated. New graph builds will populate it; old graphs will simply show no per-node staleness until refreshed.
- **Restructuring `/grasp` Phase 0.** It already does the right thing for incremental updates.
- **Auto-refreshing stale domains.** The new skill reports; the user decides.

## Design

### Change 1 — Remove freshness check from `/grasp-search`

Currently `/grasp-search/SKILL.md` (Phase 0, lines 36–60) does the global check. Remove the entire phase; searches operate on whatever the graph currently contains. The user knows the graph's state because they built it.

### Change 2 — Remove freshness check from `/grasp-domain` (with a caveat)

`/grasp-domain` currently does a global freshness check **and** a separate `domainCommit`-vs-`gitCommitHash` check (the latter is legitimate — it tells the user whether the domain graph is stale relative to the codebase). Keep the `domainCommit` check; drop the global `gitCommitHash`-vs-HEAD check, because `domainCommit`-vs-`gitCommitHash` already covers it (if the codebase moved forward, `domainCommit != gitCommitHash`).

### Change 3 — Replace `/grasp-diff` global check with per-file scope check

Current behavior (lines 93–117 of `/grasp-diff/SKILL.md`):
- Query `Project.gitCommitHash`, compare to HEAD, warn if different.

New behavior:
1. Compute the list of changed files in the diff (Phase 2 already does this).
2. For each changed file, query whether the graph has a `File` node for it and what its `analyzedAtCommit` is.
3. Categorize each changed file:
   - **Not analyzed** — no `File` node in the graph at all. Actionable warning: "this file has never been analyzed; consider running `/grasp`."
   - **Stale** — `File.analyzedAtCommit` is older than the commit that last modified the file (`git log -1 --format=%H -- <path>`). Warning: "this file's view in the graph is from commit X; current commit is Y."
   - **Fresh** — `File.analyzedAtCommit` is at or after the last modification. No warning.
4. Print only the actionable warnings.
5. Continue execution regardless — this is advisory.

The Cypher for step 2 (parameterized on the list of changed files):
```cypher
UNWIND $changedFiles AS path
OPTIONAL MATCH (f:File {filePath: path})
RETURN path, f.analyzedAtCommit AS analyzedAtCommit
```

For each `path` with a non-null `analyzedAtCommit`, the shell can compare to the last-modifying commit via `git log -1 --format=%H -- path`.

### Change 4 — Add `/grasp-freshness` skill

A new skill that produces a deliberate staleness report. The skill has these phases:

**Phase 0 — Setup.** Resolve `PROJECT_ROOT`, `PLUGIN_ROOT`, `GRASP_SKILL_DIR` (same as other skills).

**Phase 1 — Discover stale knowledge nodes.** Use the existing `findStaleImplementedBy()` from `core/src/staleness.ts`:

```typescript
import { findStaleImplementedBy } from "@grasp-it/core/staleness";
const { staleEdges } = findStaleImplementedBy(graph, currentCommit);
```

This returns knowledge nodes whose `IMPLEMENTED_BY` edges point to files whose `analyzedAtCommit` differs from HEAD. (Note: `findStaleImplementedBy` currently operates on a `KnowledgeGraph` object — for Neo4j-only mode, an equivalent Cypher must be added. See §Implementation Notes.)

**Phase 2 — Group by Domain.** For each stale node, traverse `HAS_FEATURE` / `HAS_OPERATION` to find the Domain ancestor. Group stale nodes under their Domain.

**Phase 3 — Fallback grouping.** Any stale knowledge node with no Domain ancestor is grouped by the top-level directory of its `sourceFiles` array (e.g., `src/auth/`). This fallback exists only as a transitional measure — the long-term design intent is that **every knowledge node belongs to exactly one Domain** (every `Feature`, `Operation`, `BusinessRule`, etc. is reachable from a `Domain` via `HAS_FEATURE`/`HAS_OPERATION`). The `/grasp-freshness` report surfaces unscoped nodes prominently so users notice and fix them; eventually the fallback can be removed when Domain coverage is complete.

**Phase 4 — Rank.** For each group, compute:
- Number of stale knowledge nodes.
- Number of distinct files involved.
- Oldest `analyzedAtCommit` in the group (proxy for "how far behind").

Sort groups by `(stale node count DESC, oldest commit ASC)` — most-stale first.

**Phase 5 — Report.** Output a table:

```
| Domain | Stale Nodes | Files Affected | Oldest analysis | Recommendation |
|--------|-------------|----------------|-----------------|----------------|
| auth   | 7           | 3              | 2026-04-12     | Re-run /grasp-domain for auth |
| billing | 12         | 5              | 2026-03-01     | Re-run /grasp-domain for billing |
| (src/utils/, no Domain) | 2 | 1 | 2026-05-20 | Investigate |
```

**Phase 6 — (Optional) Refresh hint.** If the user wants to refresh a specific domain, point them at `/grasp-domain` (re-derives a domain) or `/grasp --full` (rebuilds the codebase subgraph).

The skill does **not** auto-refresh. The user picks.

**Skill structure:**
```
grasp-it-plugin/skills/grasp-freshness/
  SKILL.md
```

**SKILL.md frontmatter:**
```yaml
---
name: grasp-freshness
description: Use when you want to know which parts of the knowledge graph may be stale and which domains need re-derivation
---
```

### Change 5 — `findStaleImplementedBy` and Neo4j

`findStaleImplementedBy()` operates on a `KnowledgeGraph` object (the JSON representation). The new skill needs an equivalent Cypher for the Neo4j-only path. Either:

**Option A — Add a new function `findStaleImplementedByCypher()`** to `core/src/staleness.ts` that returns the Cypher string and parameters, and have the skill call it via `run-query.mjs`.

**Option B — Run the analysis server-side** by exposing `findStaleImplementedBy` as a Neo4j procedure.

**Recommendation: Option A** for simplicity. The Cypher is straightforward:

```cypher
MATCH (k)-[r:IMPLEMENTED_BY]->(f:File)
WHERE f.analyzedAtCommit IS NOT NULL
  AND f.analyzedAtCommit <> $currentCommit
RETURN k.id AS nodeId, k.name AS nodeName,
       labels(k)[0] AS nodeType, k.sourceFiles AS sourceFiles,
       f.filePath AS filePath, f.analyzedAtCommit AS analyzedAtCommit
ORDER BY f.analyzedAtCommit
```

### Change 6 — Update `docs/graph/outdating-rules.md`

The document currently describes the global check as canonical. After this refactor, the document should be updated to:
- Note that per-skill global checks are removed.
- Point to `/grasp-freshness` as the canonical way to assess staleness.
- Document `/grasp-diff`'s new scope-check behavior.

## Implementation Plan (Phase 1 — main refactor)

Spawn four sub-agents to do the work in parallel where possible:

1. **Sub-agent A** — Remove the global freshness check from `/grasp-search/SKILL.md` and `/grasp-diff/SKILL.md`. Update `docs/graph/outdating-rules.md` to reflect the new model.
2. **Sub-agent B** — Rewrite `/grasp-diff`'s Phase 1 as a per-file scope check (uses `File.analyzedAtCommit` from Neo4j). Add unit/integration tests.
3. **Sub-agent C** — Add `findStaleImplementedByCypher()` (or equivalent) to `core/src/staleness.ts`. Add tests.
4. **Sub-agent D** — Create the new `/grasp-freshness` skill (`SKILL.md` + helper scripts if needed). Use the new Cypher from C.

Sub-agents A and D depend on C (they may use the new Cypher). C is independent. B is independent of C (it uses its own scope-check query).

Sequencing:
- C first (or in parallel with B).
- B and C in parallel.
- A and D after C.

## Implementation Plan (Phase 2 — Project node analysis)

After Phase 1 lands and is validated, spawn a sub-agent to:
- Enumerate every reference to the `Project` singleton across the codebase (`grasp-it-plugin/` and `tests/`).
- Classify each reference: still-needed-by-/grasp / still-needed-by-/grasp-domain / orphan / shared-with-something-else.
- Produce a report listing what would be required to remove the Project node entirely.

This is read-only analysis; it produces a report, not changes.

## Implementation Plan (Phase 3 — Project node removal, conditional)

Based on the Phase 2 report, decide:
- If removing Project is straightforward (only /grasp and /grasp-domain depend on it, both can be migrated to per-file/per-domain queries): spawn a sub-agent to do the migration.
- If removing Project would touch many other systems (multi-user sync, MCP server, persistence tests, etc.): defer and document.

## Validation

After each phase:
- `pnpm --filter @grasp-it/core build` — must succeed.
- `pnpm --filter @grasp-it/core test` — must pass; existing staleness tests must not regress.
- `pnpm --filter @grasp-it/skill build` — must succeed.
- `pnpm test` — full suite must pass.
- `pnpm lint` — must pass.

Manual smoke test (requires a Neo4j instance):
- Build a graph on commit A.
- Switch to a feature branch with 2 new commits.
- Run `/grasp-diff` on those 2 commits. Verify: no global staleness warning; per-file warnings only for files that are actually stale.
- Run `/grasp-freshness`. Verify: report groups stale nodes by Domain.
- Modify a file's tracked line in a new commit. Re-run `/grasp-diff`. Verify: that file now reports as stale.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Removing global checks hides real staleness from users | The new `/grasp-freshness` skill is documented and discoverable. The `/grasp-diff` scope check still warns about the files the user is asking about. |
| Existing knowledge nodes have no `sourceCommit` (legacy data) | `findStaleImplementedBy` already handles `null` `analyzedAtCommit` correctly (skips them). Legacy nodes simply don't appear in staleness reports until re-derived. |
| Branch name detection is unreliable in some setups | `/grasp-diff`'s new scope check doesn't try to detect branches — it checks per-file freshness directly, which is branch-agnostic. |
| Removing the Project node is bigger than expected | Phase 2 is read-only analysis; the decision to proceed with Phase 3 is made on its report, not assumed. |

## Open Questions

1. **Project node fate.** User feedback: my initial claim that `/grasp` Phase 0 uses the Project singleton was an assertion without code reference. The actual usage is at `skills/grasp/SKILL.md:551-562` (step 6.5 — reads `gitCommitHash` from `Project`). Whether this is essential is *not yet determined*; an equivalent query (`max(File.analyzedAtCommit)`) may suffice. Resolution: defer to Phase 2 analysis sub-agent, which will enumerate every reference and classify each as essential / replaceable / orphan. **Recommendation: do not assume Project is necessary; let Phase 2's report drive the Phase 3 decision.**

2. **Skill naming.** Approved: `/grasp-freshness`.

3. **Should `/grasp-freshness` also report on the `domainCommit` vs `gitCommitHash` relationship?** Yes, as a "domain graph may be stale relative to codebase" header line. Cheap, useful.

4. **Should `/grasp-chat`, `/grasp-gaps`, `/grasp-knowledge` also drop the global check?** Approved: all skills with the pattern drop it for consistency. Bundled into Sub-agent A's scope.

## Test Coverage

All changed code must be covered by tests. Specifically:

- `core/src/staleness.ts` additions (any new function added by Sub-agent C): unit tests alongside the existing `staleness.test.ts` and `domain-staleness.test.ts` style.
- `/grasp-diff` per-file scope check (Sub-agent B): integration test that loads a mock graph with known `analyzedAtCommit` values and asserts the right files are flagged.
- `/grasp-freshness` skill (Sub-agent D): integration test that asserts the per-domain grouping works on a graph with multiple Domains, multiple knowledge nodes per Domain, and unscoped fallback for nodes without a Domain ancestor.
- Removed-checks regression test: verify that `/grasp-search`, `/grasp-chat`, `/grasp-gaps`, `/grasp-knowledge` no longer contain the global freshness check pattern after Sub-agent A's changes.

Run `pnpm test` and `pnpm lint` after Phase 1; both must pass before Phase 2 starts.