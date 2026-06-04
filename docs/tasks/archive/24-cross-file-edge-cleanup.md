# Task 24: Fix Cross-File Edge Cleanup in Incremental Updates

## Objective

After an incremental update, remove dangling inbound edges that point to node IDs that no longer exist in the graph. This prevents phantom call/import/dependency edges from accumulating across many incremental runs.

## Background

See `docs/graph/outdating-rules.md` → "Gap 2".

**Depends on:** Task 21 (`analyzedAtCommit` on `File` nodes) — the `analyzedAtCommit` property can be used to identify which files were re-analyzed in the current run, allowing targeted inbound-edge validation.

When a file changes and its nodes are removed and re-created:
- Edges from unchanged files that point to the old node IDs (e.g., `function:src/auth.ts:oldFunctionName`) persist even if that function was renamed or deleted.
- The current merge logic only removes edges whose `source` or `target` is in the directly-removed node set. It does not do a post-merge pass to clean up inbound edges from unchanged files.

Over many incremental updates, this causes phantom edges: "file A calls function X in file B" when function X was renamed to Y two commits ago.

## Implementation Checklist

### 1. Read the current merge logic

- [ ] Read `grasp-it-plugin/packages/core/src/staleness.ts` — `mergeGraphUpdate()` function
- [ ] Read `grasp-it-plugin/skills/grasp/merge-batch-graphs.py` — the batch merge step

### 2. Post-merge inbound edge validation pass

After the new nodes are merged in, add a pass in `mergeGraphUpdate()`:

- [ ] Collect the full set of node IDs present in the updated graph (`newNodeIds`)
- [ ] Scan all edges: if `edge.target` is NOT in `newNodeIds`, the edge is dangling → remove it
- [ ] This handles cross-file dangling edges regardless of whether the source file was in the changed set

### 3. Scope the pass to changed-file targets only (performance)

To avoid scanning all edges on every incremental run:

- [ ] Only check edges whose `target` node had `filePath` matching one of the re-analyzed files (use the `analyzedAtCommit`-updated nodes from Task 21 as the scope)
- [ ] For targets from unchanged files, assume the graph is consistent (they were validated in a previous run)

### 4. Integration with `merge-batch-graphs.py`

- [ ] If the edge cleanup is most naturally done in Python (where the full graph is assembled), add the post-merge pass to `merge-batch-graphs.py` instead, and document this in the SKILL.md

### 5. Tests

- [ ] Write a test with a small graph where file A has a `CALLS` edge to `function:fileB:oldFn`, then file B is re-analyzed with `oldFn` renamed to `newFn`. After merge, the old edge should not exist.
- [ ] Run `pnpm --filter @grasp-it/core test`

## Key Files

- `grasp-it-plugin/packages/core/src/staleness.ts`
- `grasp-it-plugin/skills/grasp/merge-batch-graphs.py`
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/24-report.md`
- [ ] Move this file to `docs/tasks/archive/24-cross-file-edge-cleanup.md`
- [ ] Commit: `git add -A && git commit -m "fix: remove dangling cross-file edges after incremental graph update"`
- [ ] Push: `git push`
