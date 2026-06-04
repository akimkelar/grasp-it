# Task 34: Clarify Phase 0 vs. `check-sync` and Fix Silent Neo4j Write Failure

## Objective

Two related usability and correctness gaps found by the cross-skill consistency audit:

1. **Documentation gap** — Phase 0 staleness checks in grasp-diff, grasp-domain, and grasp-search warn about commit staleness but do not explain they compare against *git HEAD* (not Neo4j). Users who also run `check-sync.mjs` see two different commit-hash warnings with no explanation of the difference.
2. **Silent failure** — If `save-project-meta.mjs` fails after `meta.json` is successfully written, `/grasp` Phase 7 continues and exits 0. In multi-user setups, the Neo4j `Project` singleton falls out of sync without any user-visible signal.

## Background

Found by the cross-skill consistency audit. See:
- `grasp-it-plugin/skills/grasp-diff/SKILL.md` — Phase 0 Graph Freshness Check
- `grasp-it-plugin/skills/grasp-domain/SKILL.md` — Phase 1 Git Staleness Check
- `grasp-it-plugin/skills/grasp-search/SKILL.md` — Phase 0 Graph Freshness Check
- `grasp-it-plugin/skills/grasp/SKILL.md` — Phase 7 step 3.5 (`save-project-meta.mjs`)
- `grasp-it-plugin/skills/grasp/save-project-meta.mjs`

## Implementation Checklist

### Part 1: Clarify Phase 0 in each skill SKILL.md

- [ ] Open `grasp-it-plugin/skills/grasp-diff/SKILL.md` Phase 0
- [ ] Add one clarifying sentence after the staleness warning text:
  > "Note: This check compares the local graph against the current git HEAD — it does not query Neo4j. To check whether your local graph is in sync with the shared Neo4j database, run `check-sync.mjs` separately."
- [ ] Apply the same note to `grasp-it-plugin/skills/grasp-domain/SKILL.md` (Phase 1 Git Staleness Check)
- [ ] Apply the same note to `grasp-it-plugin/skills/grasp-search/SKILL.md` (Phase 0 Graph Freshness Check)

### Part 2: Surface Neo4j write failure in Phase 7

- [ ] Open `grasp-it-plugin/skills/grasp/SKILL.md` Phase 7 step 3.5
- [ ] Update the step to check the exit code of `save-project-meta.mjs`:
  - Exit 0 → silent (success or Neo4j not configured)
  - Exit 1 → print a visible warning: "Warning: Neo4j Project singleton could not be updated (see above). Other users may see a stale commit hash until the next successful `/grasp` run."
  - The skill itself should still exit 0 (the graph was saved locally; this is a sync warning, not a failure)
- [ ] Open `grasp-it-plugin/skills/grasp/save-project-meta.mjs`
- [ ] Verify it exits 1 on Neo4j write failure (as opposed to 0 for "not configured"). If exit codes are ambiguous, distinguish them:
  - Exit 0 = success OR not configured (graceful skip)
  - Exit 1 = Neo4j configured but write failed
  - Update Phase 7 step 3.5 to match

### Part 3: Document `check-sync.mjs` purpose in outdating-rules.md

- [ ] Open `docs/graph/outdating-rules.md`
- [ ] In the "Graph vs. local commit sync check" section, add a note distinguishing:
  - **Phase 0 (per-skill)**: local graph vs. local git HEAD — answers "do I need to re-run `/grasp`?"
  - **`check-sync.mjs`**: local graph vs. Neo4j Project singleton — answers "is my analysis in sync with the shared database?"

## Key Files

- `grasp-it-plugin/skills/grasp-diff/SKILL.md`
- `grasp-it-plugin/skills/grasp-domain/SKILL.md`
- `grasp-it-plugin/skills/grasp-search/SKILL.md`
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `grasp-it-plugin/skills/grasp/save-project-meta.mjs`
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Create completion report at `docs/tasks/archive/34-report.md`
- [ ] Move this file to `docs/tasks/archive/34-skill-clarity-and-silent-failure.md`
- [ ] Commit: `git add -A && git commit -m "docs: clarify Phase 0 vs check-sync and surface Neo4j write failure warning"`
- [ ] Push: `git push`
