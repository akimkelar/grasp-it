# Task 50: Define and implement merge conflict resolution for overlapping knowledge graph nodes

## Background

Both `/grasp-domain` and `/grasp-requirements` write to the same `knowledge-graph.json` file, and
both can produce nodes of the same type (e.g., `Feature`, `BusinessRule`, `Operation`) about the
same subject. They differ by `source`:

- `/grasp-domain` → `source: "code-analysis"` (what the code currently does)
- `/grasp-requirements` → `source: "interview"` (what the specialist says it should do)

The current merge logic in `grasp-requirements/SKILL.md` (Phase 5) says:

> "Nodes with the same `id` are deduplicated (keep existing if already `accepted` or `implemented`,
> otherwise update)"

This is ambiguous and problematic:
- An interview node and a code-analysis node for the same feature may have legitimately different
  `summary` fields — the code does X, the PO intends Y. Keeping one silently discards the other's perspective.
- There is no merge rule for conflicts between `source: "code-analysis"` and `source: "interview"`.
- Concurrent runs (or sequential `/grasp` then `/grasp-requirements`) could overwrite each other.

## What needs to be defined

### 1. Merge strategy for same-`id`, different-`source` nodes

When merging, if two nodes share the same `id` but have different `source` values, the correct
behavior is **not to overwrite** — both perspectives are valid and distinct. The merge should:

**Option A (recommended):** Rename the incoming node's `id` to include a source suffix if a
conflict is detected. Example:
- Existing: `feature:invoice-assignment` with `source: "code-analysis"`
- Incoming: `feature:invoice-assignment` with `source: "interview"`
- Result: keep both, rename incoming to `feature:invoice-assignment--interview`

This preserves both views and makes the conflict explicit. A separate query can then show
divergences: "Here's what the code does vs. what the PO wants."

**Option B:** Merge fields non-destructively — keep existing `summary` as `codeSummary`, add
incoming `summary` as `interviewSummary`. Only possible if the schema allows dual summaries.

**Option C:** Always prefer `interview` over `code-analysis` for semantic fields (`summary`,
`ruleText`), but keep `code-analysis` for structural fields (`status: "implemented"`).

Choose one strategy, document it clearly, and implement it consistently in both skills.

### 2. Merge strategy for same-`id`, same-`source` nodes (re-run)

If the same skill is re-run against the same topic (e.g., a second interview session about the
same feature), the merge should:
- Update `summary`, `rationale`, `scope`, `tags` — overwrite with newer values
- Keep `status: "accepted"` decisions — don't downgrade to `"draft"` on re-run
- Keep all existing edges — append new ones, don't remove existing

### 3. Surface conflicts to the user

After a merge that detects conflicts (same-id, different-source), report them to the user:
> "I found [N] nodes that already existed from code analysis. Here's where the interview
> description differs from what the code does: ..."

This turns a merge conflict into actionable information — the implementor knows where intent
and implementation diverge.

## Files to change

- `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — update Phase 5 merge logic
- `grasp-it-plugin/skills/grasp-domain/SKILL.md` — add equivalent merge logic (currently absent)
- (Optional) core merge utility if one exists: `grasp-it-plugin/packages/core/src/`

## Acceptance criteria

- Phase 5 of `grasp-requirements/SKILL.md` specifies a clear, unambiguous merge strategy for
  same-id nodes from different sources
- The strategy is the same in both `grasp-domain` and `grasp-requirements` (consistent behavior)
- After a merge with conflicts, the skill reports which nodes had conflicts and what differed
- Re-running either skill against the same topic does not destroy previously accepted decisions

## References

- `docs/architecture/neo4j-schema.md` — Shared Node Properties (`source`, `kind`), Rebuild Pattern
- `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — Phase 5
- `grasp-it-plugin/skills/grasp-domain/SKILL.md` — equivalent merge section
- Related tasks: 43 (adds `source` to types), 46 (domain-analyzer), 47 (po-interviewer), 48 (grasp-domain skill)
