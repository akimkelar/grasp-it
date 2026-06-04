# Task 24 Report: Cross-File Edge Cleanup in Incremental Updates

## Objective
After an incremental update, remove dangling inbound edges that point to node IDs that no longer exist in the graph.

## Changes Made

### 1. Modified `mergeGraphUpdate()` in `staleness.ts`

**Problem**: When a file is re-analyzed and its nodes are removed/re-created (e.g., function renamed), edges from unchanged files that pointed to the old node IDs persisted as dangling edges. This accumulated across incremental runs.

**Solution**: Restructured the edge filtering logic to:
1. Remove edges whose **source** was from a changed file (source no longer exists)
2. Keep edges whose **target** was from a changed file, **unless** the target was removed AND not re-created with the same ID (dangling edge)

**Before** (removed edges where source OR target was in removed set):
```typescript
const retainedEdges = existingGraph.edges.filter(
  (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
);
```

**After** (smarter dangling edge detection):
```typescript
const cleanedEdges = existingGraph.edges.filter((edge) => {
  // Remove edges whose source was from a changed file
  if (removedNodeIds.has(edge.source)) {
    return false;
  }
  // Remove edges whose target no longer exists in the merged graph
  if (removedNodeIds.has(edge.target) && !newNodeIds.has(edge.target)) {
    return false;
  }
  return true;
});
```

### 2. Added Tests in `staleness.test.ts`

- **"removes cross-file dangling edges when target node is replaced"**: Tests that when file B is re-analyzed with `oldFn` renamed to `newFn`, the edge from unchanged file A to `function:fileB:oldFn` is removed.

- **"keeps cross-file edges when target still exists after merge"**: Tests that when file B is re-analyzed but `existingFn` remains with the same ID, the edge from unchanged file A is preserved.

## Key Behavior

| Scenario | Result |
|----------|--------|
| Edge from unchanged file to renamed target | REMOVED (dangling) |
| Edge from unchanged file to unchanged target | KEPT |
| Edge from unchanged file to same-named target (re-analyzed file) | KEPT |
| Edge from changed file to any target | REMOVED (source gone) |

## Verification

- All 790 tests pass
- TypeScript build succeeds
- No lint issues introduced (pre-existing ESLint config issue unrelated)

## Files Changed

- `grasp-it-plugin/packages/core/src/staleness.ts` - Fixed edge cleanup logic
- `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts` - Added 2 new test cases
