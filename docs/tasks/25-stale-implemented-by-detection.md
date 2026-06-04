# Task 25: Stale `IMPLEMENTED_BY` Edge Detection After Incremental Update

## Objective

After an incremental `/grasp` update, automatically identify `IMPLEMENTED_BY` edges that point to files re-analyzed at a newer commit and mark them for review. This surfaces knowledge staleness without requiring the user to manually run Cypher queries.

## Background

See `docs/graph/outdating-rules.md` → "Gap 4" and "Knowledge nodes whose source file was updated since extraction".

**Depends on:** Task 21 (`analyzedAtCommit` on `File` nodes) — without per-file commit stamps, there is no way to identify which files were updated after the knowledge was last extracted.

When `/grasp` performs an incremental update on `src/auth.ts`, the file's node is removed and re-created with a new `analyzedAtCommit`. Any `Feature` or `Operation` with an `IMPLEMENTED_BY` edge to a node in `src/auth.ts` now has a stale reference: the code it describes has changed, but the knowledge node has not been reviewed.

## Implementation Checklist

### 1. Post-update staleness scan

After the incremental merge, add a detection step to `/grasp` SKILL.md Phase 6 (or as a new Phase 6.5):

```cypher
MATCH (k)-[:IMPLEMENTED_BY]->(f:File)
WHERE f.analyzedAtCommit IS NOT NULL
  AND f.analyzedAtCommit <> $previousCommit
RETURN labels(k)[0] AS type, k.id, k.name, f.filePath
```

- [ ] Run this query against the updated graph
- [ ] If results exist, report them to the user: "The following knowledge nodes reference files that changed — consider re-running `/grasp-domain` to refresh links"

### 2. Optional: mark edges with `status: "stale"`

- [ ] If the result set is non-empty, optionally set `status: "stale"` on affected `IMPLEMENTED_BY` edges:
  ```cypher
  MATCH (k)-[r:IMPLEMENTED_BY]->(f:File)
  WHERE f.analyzedAtCommit <> $previousCommit
  SET r.staleAsOf = $currentCommit
  ```
- [ ] This is an optional property on an existing relationship — no schema changes needed
- [ ] `/grasp-domain` should clear `staleAsOf` when it re-resolves the link

### 3. Visibility in graph-reviewer

- [ ] Update the `graph-reviewer` agent prompt (or SKILL.md) to include the `analyzedAtCommit`-based query in its staleness checks
- [ ] Report stale edges as part of the approval verdict

### 4. Documentation

- [ ] Verify the staleness query in `docs/graph/outdating-rules.md` (already added in preparation) accurately reflects the implemented behavior

### 5. Tests

- [ ] Write a test where a knowledge graph has a `Feature → IMPLEMENTED_BY → File` edge, the file is re-analyzed at a newer commit, and the staleness scan correctly identifies the feature as needing review
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/skills/grasp/SKILL.md`
- `grasp-it-plugin/packages/core/src/staleness.ts`
- `grasp-it-plugin/packages/core/src/persistence/index.ts`
- `grasp-it-plugin/agents/graph-reviewer/` (or equivalent)
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/25-report.md`
- [ ] Move this file to `docs/tasks/archive/25-stale-implemented-by-detection.md`
- [ ] Commit: `git add -A && git commit -m "feat: detect stale IMPLEMENTED_BY edges after incremental update"`
- [ ] Push: `git push`
