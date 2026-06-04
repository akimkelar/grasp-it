# Task 34 Completion Report: Clarify Phase 0 vs. `check-sync` and Fix Silent Neo4j Write Failure

## Changes Made

### Part 1: Clarified Phase 0 staleness check in three skill SKILL.md files

Added the following note after the staleness warning text in each skill:

> **Note:** This check compares the local graph against the current git HEAD — it does not query Neo4j. To check whether your local graph is in sync with the shared Neo4j database, run `check-sync.mjs` separately.

**Files updated:**
- `grasp-it-plugin/skills/grasp-diff/SKILL.md` — Phase 0 Graph Freshness Check
- `grasp-it-plugin/skills/grasp-domain/SKILL.md` — Phase 1 Git Staleness Check
- `grasp-it-plugin/skills/grasp-search/SKILL.md` — Phase 0 Graph Freshness Check

### Part 2: Surface Neo4j write failure in Phase 7 of `/grasp`

Updated `grasp-it-plugin/skills/grasp/SKILL.md` Phase 7 step 3.5 to capture and act on the exit code of `save-project-meta.mjs`:

- Exit code 0 → success or Neo4j not configured (graceful skip, unchanged behavior)
- Exit code 1 → Neo4j was configured but write failed → print visible warning: "Warning: Neo4j Project singleton could not be updated (see above). Other users may see a stale commit hash until the next successful `/grasp` run."

The skill itself still exits 0 — the local graph was saved successfully; this is a sync warning, not a local failure. The exit code behavior of `save-project-meta.mjs` was already correct (exit 1 on write failure, exit 0 on graceful skip), so no changes were needed to the script itself.

### Part 3: Documented `check-sync.mjs` purpose in outdating-rules.md

Added a table to the "Graph vs. local commit sync check" section in `docs/graph/outdating-rules.md` distinguishing:

| Check | Compares | Answers |
|-------|----------|---------|
| **Phase 0 staleness check** (per-skill) | Local graph `gitCommitHash` vs. local git HEAD | "Do I need to re-run `/grasp`?" |
| **`check-sync.mjs`** | Local graph `gitCommitHash` vs. Neo4j `Project` singleton | "Is my analysis in sync with the shared Neo4j database?" |

## Verification

All 234 tests pass (`pnpm test`).

## Files Changed

- `grasp-it-plugin/skills/grasp-diff/SKILL.md`
- `grasp-it-plugin/skills/grasp-domain/SKILL.md`
- `grasp-it-plugin/skills/grasp-search/SKILL.md`
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `docs/graph/outdating-rules.md`
