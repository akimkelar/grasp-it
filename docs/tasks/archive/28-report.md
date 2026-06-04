# Task 28 Completion Report: Add Pre-Flight Staleness Warnings to Skills

## Summary

Added pre-flight staleness warnings to `/grasp-diff`, `/grasp-domain`, and `/grasp-search` to warn users when the knowledge graph may be stale before proceeding with analysis.

## Changes Made

### 1. Core: Added `checkGraphFreshness()` function

**File:** `grasp-it-plugin/packages/core/src/staleness.ts`

Added:
- `GraphFreshnessResult` interface with fields: `stale`, `lastCommit`, `headCommit`, `commitsBehind`
- `checkGraphFreshness(projectDir)` function that:
  - Reads `gitCommitHash` from `knowledge-graph.json` (preferred) or `.grasp-it/meta.json` (fallback)
  - Compares with current HEAD (`git rev-parse HEAD`)
  - Calculates commits behind using `git rev-list --count <last>..HEAD`
  - Returns `stale: true` if no graph exists yet

### 2. Core: Export new symbols

**File:** `grasp-it-plugin/packages/core/src/index.ts`

Added exports for `checkGraphFreshness` and `GraphFreshnessResult`.

### 3. `/grasp-diff`: Added Phase 0 - Graph Freshness Check

**File:** `grasp-it-plugin/skills/grasp-diff/SKILL.md`

- Added `### Phase 0: Graph Freshness Check` section before existing content
- Instructs agent to read `gitCommitHash` from graph/meta, compare with HEAD, and print warning if stale
- Warning format: "⚠ Graph may be stale — last analyzed at `<lastCommit>` (`N` commits behind HEAD). Results may not reflect recent changes. Run `/grasp` to update."
- Execution continues regardless (advisory only)

### 4. `/grasp-domain`: Added Phase 1 - Git Staleness Check

**File:** `grasp-it-plugin/skills/grasp-domain/SKILL.md`

- Inserted `### Phase 1: Git Staleness Check` after the PROJECT_ROOT resolution section
- Same staleness check and warning as `/grasp-diff`
- Renumbered subsequent phases (Phase 1 became Phase 2, Phase 2 became Phase 3, etc.)
- Existing Phase 1 (domain graph staleness check with `domainGraphStale` flag) is now Phase 2

### 5. `/grasp-search`: Added Phase 0 - Graph Freshness Check

**File:** `grasp-it-plugin/skills/grasp-search/SKILL.md`

- Added `### Phase 0: Graph Freshness Check` section before the "Quick health check" section
- Same staleness check and warning as other skills

### 6. Tests: Added unit tests for `checkGraphFreshness`

**File:** `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts`

Added 23 new test cases covering:
- Returns stale when neither `knowledge-graph.json` nor `meta.json` exists
- Returns stale=false when graph commit matches HEAD
- Returns stale=true with correct `commitsBehind` when graph is behind HEAD
- Falls back to `meta.json` when `knowledge-graph.json` is unavailable
- Handles git error when getting HEAD gracefully
- Handles git error when counting commits (e.g., rebased commit)

## Verification

- **Build:** `pnpm --filter @grasp-it/core build` passes
- **Core tests:** 808 tests pass (including 23 new staleness tests)
- **All tests:** 221 skill tests pass

## Files Modified

1. `grasp-it-plugin/packages/core/src/staleness.ts` - Added `checkGraphFreshness()` and `GraphFreshnessResult`
2. `grasp-it-plugin/packages/core/src/index.ts` - Export new symbols
3. `grasp-it-plugin/skills/grasp-diff/SKILL.md` - Added Phase 0 staleness check
4. `grasp-it-plugin/skills/grasp-domain/SKILL.md` - Added Phase 1 staleness check, renumbered phases
5. `grasp-it-plugin/skills/grasp-search/SKILL.md` - Added Phase 0 staleness check
6. `grasp-it-plugin/packages/core/src/__tests__/staleness.test.ts` - Added 23 unit tests

## Notes

- The lint check (`pnpm lint`) fails with an ESLint config error - this is a pre-existing issue unrelated to this task
- The preflight check is non-blocking - execution continues regardless of staleness status
- The warning message includes the number of commits behind HEAD and suggests running `/grasp` to update
