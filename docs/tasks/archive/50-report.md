# Task 50 Report: Define and implement merge conflict resolution for overlapping knowledge graph nodes

## Summary

Implemented a clear, unambiguous merge strategy for same-`id` nodes from different sources in both `/grasp-requirements` and `/grasp-domain` skills, adopting **Option A** (rename with source suffix) as the recommended approach.

## Changes Made

### 1. `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — Phase 5 rewrite

Replaced the ambiguous "keep existing if accepted/implemented, otherwise replace" language with a detailed7-step merge procedure:

- **5a. Load existing graph** — read `knowledge-graph.json` and `pr-nodes.json`/`pr-edges.json`
- **5b. Classify each incoming node** by comparing `id` and `source`:
  - Same `id`, same `source: "interview"` (re-run): update fields, preserve accepted/implemented status, append new edges
  - Same `id`, different `source` (conflict): rename incoming node with `--interview` suffix, preserve both perspectives
  - New `id`: append as-is
- **5c. Track conflicts** — maintain a `conflicts[]` list for user reporting
- **5d. Merge edges** — deduplicate by `(source, target, type)`
- **5e. Ensure layer exists** — add new/renamed nodes to `layer:knowledge`
- **5f. Validate and write** — validate against schema, write back to `knowledge-graph.json`
- **5g. Report conflicts to user** — after merge, report all conflicts with existing vs. incoming summaries

### 2. `grasp-it-plugin/skills/grasp-domain/SKILL.md` — Added Phase 6b merge logic

Added a new **Phase 6b: Merge into Domain Graph** section (numbered consistently with grasp-requirements) that mirrors the same strategy:

- **6b-1. Load existing domain graph** — read `domain-graph.json` and new domain analysis output
- **6b-2. Classify each incoming node** — same three-way classification (same-id/same-source, same-id/different-source, new-id)
- **6b-3. Track conflicts** — same `conflicts[]` list
- **6b-4. Merge edges** — deduplicate by `(source, target, type)`
- **6b-5. Validate and write** — validate, write to `domain-graph.json`, report conflicts

Also corrected Phase numbering: Clean Up is now Phase 7, Launch Dashboard is Phase 8.

## Strategy Summary

| Scenario | Behavior |
|---|---|
| Same `id`, same `source` (re-run) | Update `summary`/`rationale`/`scope`/`tags`; keep `status: "accepted"` decisions; append new edges |
| Same `id`, different `source` (conflict) | Rename incoming node: `feature:invoice-assignment` → `feature:invoice-assignment--interview` |
| New `id` | Append as-is |

Both skills now surface conflicts to the user after merge with a human-readable diff of summaries.

## Acceptance Criteria Met

- Phase 5 of `grasp-requirements/SKILL.md` specifies a clear, unambiguous merge strategy for same-id nodes from different sources — **done**
- The strategy is the same in both `grasp-domain` and `grasp-requirements` — **done**
- After a merge with conflicts, the skill reports which nodes had conflicts and what differed — **done**
- Re-running either skill against the same topic does not destroy previously accepted decisions — **done** (status preservation logic)

## Files Changed

- `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — Phase 5 expanded from ~10 lines to ~50 lines
- `grasp-it-plugin/skills/grasp-domain/SKILL.md` — Phase 6b added (~35 lines), Phase7/8 renumbered