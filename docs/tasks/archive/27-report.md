# Task 27 Report: Commit Sync Check Script

## Summary

Implemented `check-sync.mjs` — a script that compares the git commit hash stored in the local `knowledge-graph.json` against the `Project` singleton node in Neo4j, enabling multi-user teams to verify graph freshness before querying.

## What Was Built

**Script:** `grasp-it-plugin/skills/grasp/check-sync.mjs`

A standalone Node.js script that:
1. Reads `gitCommitHash` from `.grasp-it/knowledge-graph.json` (local)
2. Queries Neo4j for the `Project` singleton's `gitCommitHash` (remote)
3. Compares the two commits using `git merge-base --is-ancestor` to determine ancestry (not just equality)
4. Reports the sync status with actionable guidance based on exit code

**Exit codes:**
- `0` — In sync or local-behind (action: pull / re-run `/grasp`)
- `1` — Local-ahead on tracked branch (action: safe to update Neo4j)
- `2` — Diverged or local-ahead on feature branch (manual resolution)
- `3` — Neo4j has no analysis yet (action: run `/grasp` to initialize)
- `4` — Local graph not found (no `knowledge-graph.json`)

**Neo4j integration:** Uses the existing `loadProjectMeta` / `saveProjectMeta` pattern from `grasp-it-plugin/packages/core/src/persistence/index.ts` (Project singleton at `id: "project:singleton"`).

**Config detection:** Reads Neo4j credentials from environment variables (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`) or from a `.env` file at the project root.

**Branch reachability check:** When local is ahead, checks whether the current branch is `main` or `develop` via `git rev-parse --symbolic-full-name HEAD` and whether the commit is reachable from `origin/main` or `origin/develop`. If on a tracked branch, reports "safe to update"; if on a feature branch, warns that Neo4j won't be updated until the branch is merged.

**Test mock:** `CHECK_SYNC_MOCK_NEO4J_COMMIT` environment variable allows tests to simulate Neo4j responses without a real database.

## Tests

**File:** `tests/skill/grasp/test_check_sync.test.mjs` — 7 test cases covering all exit code paths:

| Test | Exit Code | Scenario |
|------|-----------|----------|
| In sync | 0 | Local and Neo4j at same commit |
| Local behind | 0 | Local commit is ancestor of Neo4j commit |
| Local ahead on tracked branch | 1 | On main/develop, commit ahead of Neo4j |
| Local ahead on feature branch | 2 | On feature branch, commit ahead of Neo4j |
| Diverged | 2 | Neither commit is ancestor of the other |
| No Neo4j analysis | 3 | Neo4j returns null (empty `CHECK_SYNC_MOCK_NEO4J_COMMIT`) |
| No local graph | 4 | `knowledge-graph.json` does not exist |

All 221 tests pass (`pnpm test`).

## Key Files

- **Script:** `grasp-it-plugin/skills/grasp/check-sync.mjs`
- **Tests:** `tests/skill/grasp/test_check_sync.test.mjs`
- **Neo4j persistence:** `grasp-it-plugin/packages/core/src/persistence/index.ts` (loadProjectMeta/saveProjectMeta)
- **Schema reference:** `docs/architecture/neo4j-schema.md` (Project singleton node design)
- **Outdating rules:** `docs/graph/outdating-rules.md` (Graph vs. local commit sync check)

## Usage

```bash
# Check sync status from project root
node grasp-it-plugin/skills/grasp/check-sync.mjs /path/to/project

# Or from within the project directory
node grasp-it-plugin/skills/grasp/check-sync.mjs
```

Neo4j credentials are read from environment or `.env` file. The script is also usable as a preflight check in `/grasp-diff` Phase 0 (optional integration point noted in task checklist item 3).