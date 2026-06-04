# Task 33: Add Medium and Low Priority Missing Test Cases

## Objective

Add tests for four medium-priority and one low-priority coverage gaps. These are less likely to hide critical bugs than Task 32, but all represent uncovered error paths that could cause confusing failures in production.

## Background

Found by the test coverage consistency audit. See also `docs/tasks/archive/32-report.md` for the high-priority gaps addressed first.

## Implementation Checklist

### Gap 1 (Medium): `check-sync.mjs` — git not available or not a repo

**File:** `tests/skill/grasp/test_check_sync.test.mjs`

- [ ] Add test: "exits with error when project root is not a git repository"
  - Setup: pass a temp directory that is NOT a git repo as `$PROJECT_ROOT`
  - The script should exit non-zero with a clear error message (not an unhandled exception stack trace)
  - Verify the exit code is consistent with the documented codes (or document a new code for "not a git repo")

### Gap 2 (Medium): `saveProjectMeta` / `loadProjectMeta` — Neo4j session errors

**File:** `grasp-it-plugin/packages/core/src/__tests__/persistence.test.ts`

- [ ] Add test: "`saveProjectMeta` propagates error when `session.run()` throws"
  - Setup: mock `session.run` to throw `new Error("Connection timeout")`
  - Expect `saveProjectMeta` to re-throw (or wrap and throw) — not swallow silently
- [ ] Add test: "`loadProjectMeta` returns null when record has unexpected shape"
  - Setup: mock `session.run` to return a record where `p.gitCommitHash` is `null`
  - Expect the function to return `null` or a safe default, not throw

### Gap 3 (Medium): `domain-stale-flag` — malformed `domain-graph.json`

**File:** `grasp-it-plugin/packages/core/src/__tests__/domain-stale-flag.test.ts`

- [ ] Add test: "handles malformed domain-graph.json (invalid JSON) without throwing"
  - Setup: write `"not valid json"` to `domain-graph.json`
  - The staleness detection logic should catch the parse error and skip the staleness check (treat as if domain-graph.json does not exist)
- [ ] Add test: "handles domain-graph.json missing `project.gitCommitHash` without throwing"
  - Setup: write `{ "nodes": [], "edges": [] }` (valid JSON, no `project` field)
  - Expect graceful skip — does not set `domainGraphStale: true` based on a missing/undefined hash

### Gap 4 (Medium): `merge-subdomain-graphs.py` — null/empty `gitCommitHash`

**File:** `grasp-it-plugin/src/__tests__/merge-subdomain-graphs.test.mjs`

- [ ] Add test: "handles subdomain graph with null or empty gitCommitHash without emitting false staleness warning"
  - Setup: two graphs, one with `gitCommitHash: "abc123"` and one with `gitCommitHash: ""` (or missing field)
  - The empty hash should be excluded from the staleness comparison (skip, don't warn "different commits")
  - The resolved hash should be `"abc123"` from the non-empty graph

### Gap 5 (Low): `analyzedAtCommit` in incremental update path

**File:** `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`

- [ ] Add test: "file nodes in the incremental update carry analyzedAtCommit matching the new commit"
  - Setup: existing graph with file node `file:src/a.ts` with `analyzedAtCommit: "oldHash"`. Run `mergeGraphUpdate` with a new graph where `file:src/a.ts` has `analyzedAtCommit: "newHash"`.
  - After merge, the file node in the result must have `analyzedAtCommit: "newHash"` (not `"oldHash"`).

## Key Files

- `tests/skill/grasp/test_check_sync.test.mjs`
- `grasp-it-plugin/packages/core/src/__tests__/persistence.test.ts`
- `grasp-it-plugin/packages/core/src/__tests__/domain-stale-flag.test.ts`
- `grasp-it-plugin/src/__tests__/merge-subdomain-graphs.test.mjs`
- `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/33-report.md`
- [ ] Move this file to `docs/tasks/archive/33-medium-priority-test-gaps.md`
- [ ] Commit: `git add -A && git commit -m "test: add medium and low priority missing test cases for error paths"`
- [ ] Push: `git push`
