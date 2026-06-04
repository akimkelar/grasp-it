# Task 27: Add Commit Sync Check Script (Local vs. Neo4j)

## Objective

Add a script that compares the git commit hash stored in the local `knowledge-graph.json` against the `Project` singleton node in Neo4j, and reports which is ahead, behind, or in sync. This enables multi-user teams to verify graph freshness before querying.

## Background

See `docs/graph/outdating-rules.md` → "Graph vs. local commit sync check" and the multi-user scenario analysis in `docs/tasks/archive/20-report.md`.

**Depends on:** Task 22 (`Project` singleton node must exist in Neo4j to query).

In a multi-user cloud Neo4j setup, different team members may have analyzed the graph at different commits. The sync script answers:
- Is my local graph ahead of Neo4j? → I can push my analysis
- Is Neo4j ahead of me? → I should pull (re-run `/grasp`) before querying
- Are they diverged on different branches? → warn and require manual resolution

Ancestry is determined via `git merge-base` (not timestamp comparison, which can be wrong across machines).

## Implementation Checklist

### 1. Create the script

- [ ] Create `grasp-it-plugin/skills/grasp/check-sync.mjs` (or a core utility)
- [ ] Script flow:
  1. Read local `gitCommitHash` from `.grasp-it/knowledge-graph.json` → `project.gitCommitHash`
  2. Query Neo4j for `Project` singleton: `MATCH (p:Project {id: "project:singleton"}) RETURN p.gitCommitHash`
  3. If Neo4j returns null → "Neo4j has no analysis yet; run `/grasp` to initialize"
  4. If hashes are equal → "In sync"
  5. Run `git merge-base --is-ancestor <localHash> <neo4jHash>` → if true, local is behind
  6. Run `git merge-base --is-ancestor <neo4jHash> <localHash>` → if true, local is ahead
  7. If neither → hashes are on diverged branches → warn

### 2. Branch reachability check (local-is-ahead path)

- [ ] When local is ahead of Neo4j, also check whether `localHash` is reachable from `main` or `develop`:
  ```bash
  git merge-base --is-ancestor <localHash> origin/main
  git merge-base --is-ancestor <localHash> origin/develop
  ```
- [ ] If reachable: "Local analysis is ahead and on a tracked branch — safe to update Neo4j by running `/grasp`"
- [ ] If not reachable: "Local analysis is on a feature branch — Neo4j will not be updated until this branch is merged"

### 3. Expose as a skill step or standalone command

- [ ] Optionally expose as a step in `/grasp-diff` Phase 0 preflight (print sync status before running diff)
- [ ] Also usable as a standalone: `node check-sync.mjs` from project root

### 4. Tests

- [ ] Unit test: mock Neo4j response and git ancestry checks, verify each output case (in-sync, behind, ahead, diverged)
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/skills/grasp/` (new script)
- `grasp-it-plugin/packages/core/src/persistence/index.ts` (Neo4j query helper)
- `grasp-it-plugin/skills/grasp-diff/SKILL.md` (optional integration)
- `docs/graph/outdating-rules.md`
- `docs/architecture/neo4j-schema.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/27-report.md`
- [ ] Move this file to `docs/tasks/archive/27-commit-sync-check-script.md`
- [ ] Commit: `git add -A && git commit -m "feat: add commit sync check script for local vs Neo4j graph comparison"`
- [ ] Push: `git push`
