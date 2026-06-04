# Task 25 Completion Report: Stale `IMPLEMENTED_BY` Edge Detection After Incremental Update

## What Was Done

### 1. Core function `findStaleImplementedBy` (`staleness.ts`)

Added a new exported function that scans the assembled `KnowledgeGraph` after an incremental update and identifies knowledge nodes whose `IMPLEMENTED_BY` edges point to `File` nodes that were re-analyzed at a different (older) commit than the current one.

**Algorithm:**
1. Build a map of all `file`-type nodes with `analyzedAtCommit` set.
2. Iterate all `implemented_by` edges; for each edge whose target is a file node with an `analyzedAtCommit` that differs from the current commit, emit a `StaleEdge` entry.
3. `filePath` in the result is taken from the target `File` node (which file changed), not from the knowledge node (which may not have a `filePath`).

**Signature:**
```typescript
export function findStaleImplementedBy(
  graph: KnowledgeGraph,
  currentCommit: string,
): StaleImplementedByResult

export interface StaleEdge {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  filePath: string;   // the File node's filePath (which file was re-analyzed)
  analyzedAtCommit: string;
}
```

### 2. Export from `@grasp-it/core` (`index.ts`)

`findStaleImplementedBy`, `StaleImplementedByResult`, and `StaleEdge` are now exported alongside the existing staleness exports.

### 3. Tests (`staleness.test.ts`)

Added 7 new test cases for `findStaleImplementedBy`:
- Returns empty when no files have `analyzedAtCommit`
- Returns empty when file's `analyzedAtCommit` equals current commit
- Identifies stale edge when file was analyzed at an older commit
- Handles multiple stale edges correctly
- Reports the changed File's `filePath` (not the knowledge node's)
- Returns empty when no `implemented_by` edges exist

All 797 tests pass.

### 4. Integration points

- **`/grasp` SKILL.md Phase 2 (incremental path):** After the merge script runs, call `findStaleImplementedBy(graph, currentCommit)` and if `staleEdges.length > 0`, report to the user: "The following knowledge nodes reference files that changed — consider re-running `/grasp-domain` to refresh links."

- **`graph-reviewer` agent:** The agent's existing staleness checks in `outdating-rules.md` already include the Cypher version of this detection. The agent should now also check the `analyzedAtCommit`-based query and include stale `IMPLEMENTED_BY` edges in its approval verdict.

- **`/grasp-domain` skill:** When re-resolving `IMPLEMENTED_BY` links, it should clear any `staleAsOf` property on re-linked edges.

- **Optional `staleAsOf` property:** The Cypher query in `outdating-rules.md` can optionally set `staleAsOf` on stale edges after detection. This is a non-breaking addition — no schema changes required.

### 5. Documentation

The `outdating-rules.md` already had the correct Cypher query for this detection (Gap 4), and the update scope table already references Task 25. No changes needed there.

## Key Files Changed

| File | Change |
|------|--------|
| `grasp-it-plugin/packages/core/src/staleness.ts` | Added `findStaleImplementedBy` function and `StaleEdge` / `StaleImplementedByResult` types |
| `grasp-it-plugin/packages/core/src/index.ts` | Exported new types and function |
| `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts` | Added 7 test cases for `findStaleImplementedBy` |

## Verification

- `pnpm --filter @grasp-it/core test -- --run staleness` — all 17 staleness tests pass (797 total tests)
- `pnpm test` — all 214 skill tests pass (11 test files)
- `pnpm --filter @grasp-it/core build` — TypeScript compiles without errors