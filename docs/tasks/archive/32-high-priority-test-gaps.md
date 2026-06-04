# Task 32: Add High-Priority Missing Test Cases

## Objective

Add tests for three high-risk gaps where missing coverage could hide real bugs. All three involve code paths that could fail silently or produce incorrect results without a test to catch it.

## Background

Found by the test coverage consistency audit. These are the highest-risk gaps:

1. **`mergeGraphUpdate` source rename** — if a function is renamed in a changed file, outbound edges FROM the old function ID dangle. Only the reverse (dangling inbound target) is currently tested.
2. **`findStaleImplementedBy` with multiple edges per knowledge node** — a knowledge node can have several `IMPLEMENTED_BY` edges to different files; only some may be stale. Currently every test assumes a 1:1 ratio.
3. **`checkGraphFreshness` with malformed `knowledge-graph.json`** — if the file exists but contains invalid JSON, the function may throw instead of degrading gracefully.

## Implementation Checklist

### Gap 1: `mergeGraphUpdate` — source rename not tested

**File:** `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`

- [ ] Add test: "removes outbound edges from a source node whose ID changed after re-analysis"
  - Setup: graph has `function:fileA:foo` with an outbound `CALLS` edge to `function:fileB:bar`. File A is in the changed set; re-analysis renames `foo` to `baz` (node ID changes from `function:fileA:foo` to `function:fileA:baz`).
  - After `mergeGraphUpdate`, the old `CALLS` edge from `function:fileA:foo` must NOT exist (source removed and not re-created with same ID).
  - The new node `function:fileA:baz` is present but has no old edges.

### Gap 2: `findStaleImplementedBy` — multiple edges, partial staleness

**File:** `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`

- [ ] Add test: "returns only stale edges when a knowledge node has multiple IMPLEMENTED_BY edges and only some are stale"
  - Setup: `feature:auth` has `IMPLEMENTED_BY` edges to:
    - `file:src/auth.ts` with `analyzedAtCommit: "oldCommit"` (stale)
    - `file:src/auth-utils.ts` with `analyzedAtCommit: "currentCommit"` (fresh)
  - `findStaleImplementedBy(graph, "currentCommit")` must return exactly one stale edge (for `src/auth.ts`), not two and not zero.

### Gap 3: `checkGraphFreshness` — malformed `knowledge-graph.json`

**File:** `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`

- [ ] Add test: "falls back gracefully when knowledge-graph.json contains invalid JSON"
  - Setup: write `"not-valid-json{{"` to `knowledge-graph.json`; `meta.json` does not exist.
  - `checkGraphFreshness` must return `{ stale: true, lastCommit: "", headCommit: <HEAD>, commitsBehind: 0 }` (or similar safe fallback) rather than throwing.
- [ ] Add test: "falls back gracefully when knowledge-graph.json is missing project.gitCommitHash"
  - Setup: write `{ "nodes": [], "edges": [] }` (valid JSON but no `project` field).
  - Expect the same graceful fallback.

## Key Files

- `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`
- `grasp-it-plugin/packages/core/src/staleness.ts` (fix any throw-paths found during testing)

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/32-report.md`
- [ ] Move this file to `docs/tasks/archive/32-high-priority-test-gaps.md`
- [ ] Commit: `git add -A && git commit -m "test: add high-priority missing test cases for mergeGraphUpdate, findStaleImplementedBy, checkGraphFreshness"`
- [ ] Push: `git push`
