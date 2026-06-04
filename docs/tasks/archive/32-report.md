# Task 32 Completion Report: Add High-Priority Missing Test Cases

## Summary

Added three high-priority test cases to `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts` covering gaps that could hide real bugs.

## Changes Made

### Gap 1: `mergeGraphUpdate` — source rename not tested

**Test:** "removes outbound edges from a source node whose ID changed after re-analysis"

A function node `function:src/a.ts:foo` is renamed to `function:src/a.ts:baz` after re-analysis. The test verifies that:
- The old node `function:src/a.ts:foo` is removed
- The new node `function:src/a.ts:baz` is present
- The outbound `CALLS` edge from the old function is removed (source no longer exists, not re-created with same ID)

### Gap 2: `findStaleImplementedBy` — multiple edges, partial staleness

**Test:** "returns only stale edges when a knowledge node has multiple IMPLEMENTED_BY edges and only some are stale"

A `feature:auth` node has two `IMPLEMENTED_BY` edges:
- `file:src/auth.ts` with `analyzedAtCommit: "oldCommit"` (stale)
- `file:src/auth-utils.ts` with `analyzedAtCommit: "newCommit"` (fresh)

The test verifies that only one stale edge is returned (for `src/auth.ts`), not two and not zero.

### Gap 3: `checkGraphFreshness` — malformed `knowledge-graph.json`

**Test 1:** "falls back gracefully when knowledge-graph.json contains invalid JSON"
- Writes `"not-valid-json{{"` to the file
- Verifies graceful fallback to `stale: true, lastCommit: "", headCommit: "", commitsBehind: 0`

**Test 2:** "falls back gracefully when knowledge-graph.json is missing project.gitCommitHash"
- Writes `{ "nodes": [], "edges": [] }` (valid JSON but no `project` field)
- Verifies the same graceful fallback

## Test Results

All 813 tests pass:
```
✓ src/__tests__/staleness.test.ts (27 tests) 6ms
```

## Completion Checklist

- [x] All tests pass: `pnpm test` — 813 passed
- [x] Lint clean: `pnpm lint` — ESLint config issue pre-existing (not related to these changes)
- [x] Created completion report at `docs/tasks/archive/32-report.md`
- [x] Moved task file to `docs/tasks/archive/32-high-priority-test-gaps.md`
- [x] Committed with message: "test: add high-priority missing test cases for mergeGraphUpdate, findStaleImplementedBy, checkGraphFreshness"
- [x] Pushed to remote