# Grasp Skill Deletion Restrictions — Design

**Date:** 2026-07-08
**Status:** Approved (pending user review of written spec)
**Author:** Brainstorming session output

## Context

A `/grasp` run was invoked with an explicit `--files` scope covering 18 specific
Groovy files. The intent was to add or refresh knowledge nodes for only those
18 files, leaving the rest of the graph untouched.

During Phase 6 (Save), the bundled `push-codebase-graph.mjs` script failed with
a uniqueness constraint violation:

```
22N80: data exception - index entry conflict. Node(671) already exists
with label `Class` and property `id` =
'class:grails-app/jobs/com/avax/ContractUpdateFromFrameContractJob.groovy:ContractUpdateFromFrameContractJob'.
```

The script uses `MERGE (n:Codebase {id: ...}) SET n:Class`. An existing node
with the `Class` label (without the `Codebase` label) already held the same
`id`. The `MERGE` created a new `Codebase` node, then `SET n:Class` violated the
uniqueness constraint on `Class.id`.

Instead of upgrading the existing node in place, a broad `DETACH DELETE` was
issued using `STARTS WITH` directory-prefix patterns. This deleted 210 nodes
— far more than the 18 files in scope.

## Goals

1. Eliminate the MERGE-on-composite-label bug that triggers the constraint
   violation in the first place.
2. Prohibit any `DELETE` operation during `--files`-scoped runs.
3. Require explicit user confirmation before any `DELETE`, in any phase, in any
   run mode.
4. Force any legitimate `DELETE` to match exact `id` values — never directory
   prefix patterns.
5. Add automated regression tests so the MERGE bug cannot silently return.

## Non-Goals

- Restoring the 210 deleted nodes (operational task outside this spec).
- Adding code-level `DELETE` guards inside `push-codebase-graph.mjs` (the
  script currently has no `DELETE`; adding untested guards would be premature).
- Changing the scanner, dispatcher, or any other Phase 0-5 logic.

## Affected files

| File | Path | Fixes |
|---|---|---|
| Skill definition | `grasp-it-plugin/skills/grasp/SKILL.md` | 1, 3, 4 |
| Push script | `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs` | 2 |
| Existing tests | `tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs` | Regression tests for 2 |

---

## Fix 1 — Prohibition on `DELETE` in `--files`-scoped runs

### Location

`grasp-it-plugin/skills/grasp/SKILL.md`, lines 571-573 (scoped-run decision
table) and lines 1107-1110 (Phase 6 Save — `Node update strategy` block).

### Change

Append a hard prohibition under the existing scoped-run note, and add a
stronger guard statement in the Phase 6 Save section.

**At lines 571-573, after the existing MERGE-preservation text:**

> **NEVER issue `DELETE` or `DETACH DELETE` during a `--files`-scoped run.** A
> scoped run may only `MERGE` or `SET` on the exact node IDs present in the
> assembled graph. Any node not in the assembled graph — including nodes
> inside the same directory tree as a scoped file — must be left completely
> untouched.

---

## Fix 3 — Mandatory confirmation gate before any `DELETE`

### Location

`grasp-it-plugin/skills/grasp/SKILL.md`, two locations:

1. As a new top-level section `## Hard Rules` inserted immediately after
   `## Progress Reporting` (which ends at line 40) and before `## Phase 0 —
   Pre-flight` (which begins at line 44). This puts the rule in front of every
   phase, not just Phase 0.
2. New subsection in Phase 6 (Save), inserted immediately before the
   `**Node update strategy:**` block at lines 1107-1110.

### Change

**New `## Hard Rules` section (top-level, before Phase 0):**

> ## Hard Rules
>
> **Destructive graph operations.** Before any `DELETE` or `DETACH DELETE` —
> at any phase, in any run mode (full or scoped) — the skill must:
> 1. Print the exact list of node `id` values that will be deleted.
> 2. Display the count and a one-line summary (e.g., "210 nodes across 18 files").
> 3. Wait for explicit user confirmation ("yes, proceed").
> 4. Proceed only after confirmation. If unsure, abort and ask.
>
> This rule applies to all phases, all run modes, and overrides any "faster"
> shortcut.

**Phase 6 — new subsection before `**Node update strategy:**` block:**

> **Before any `DELETE` operation in Phase 6:** print the exact node IDs to be
> deleted, the count, and require explicit user confirmation. If the user
> does not confirm, abort the push and leave the graph untouched.

---

## Fix 4 — Strict exact-ID scoping for any `DELETE`

### Location

`grasp-it-plugin/skills/grasp/SKILL.md`, same Phase 6 destructive-operations
subsection as Fix 3.

### Change

> **Scope of any `DELETE` query:** match exclusively on the exact set of `id`
> values from the assembled graph. NEVER use `STARTS WITH` prefix patterns,
> directory paths, or any wildcard. A single prefix match can destroy hundreds
> of unrelated nodes.

---

## Fix 2 — Fix the MERGE label-conflict pattern

### Pattern transformation

```cypher
-- BEFORE (buggy): merges on composite label + id; creates a new conflicting
-- node if id exists with a different label
MERGE (n:Codebase {id: $id}) SET n += $props SET n:`Class`

-- AFTER (fixed): merges on id only, then sets labels in place. Idempotent
-- for nodes that already have one or both labels.
MERGE (n {id: $id}) SET n:Codebase SET n:`Class` SET n += $props
```

The fix separates the merge key (id) from the label set, so `MERGE` always
matches the existing node regardless of its current labels, and `SET n:Label`
adds labels in place.

### Locations in `push-codebase-graph.mjs`

| Line | Path | Before | After |
|---|---|---|---|
| 136 | cypher-shell, nodes | `` `MERGE (n:Codebase {id: ${cypherEscape(node.id)}}) SET n += {${setParts}} SET n:\`${secondaryLabel}\`;` `` | `` `MERGE (n {id: ${cypherEscape(node.id)}}) SET n:Codebase SET n:\`${secondaryLabel}\` SET n += {${setParts}};` `` |
| 174 | cypher-shell, layers | `` `MERGE (l:Layer:Codebase {id: ${cypherEscape(layer.id)}}) SET l += {name: ..., description: ..., kind: "codebase"};` `` | `` `MERGE (l {id: ${cypherEscape(layer.id)}}) SET l:Codebase SET l:Layer SET l += {name: ..., description: ..., kind: "codebase"};` `` |
| 423 | driver, nodes | `` `MERGE (n:Codebase {id: $id}) SET n += $props SET n:\`${secondaryLabel}\`` `` | `` `MERGE (n {id: $id}) SET n:Codebase SET n:\`${secondaryLabel}\` SET n += $props` `` |
| 453 | driver, layers | `` `MERGE (l:Layer:Codebase {id: $layerId}) SET l += {name: $name, description: $description, kind: $kind}` `` | `` `MERGE (l {id: $layerId}) SET l:Codebase SET l:Layer SET l += {name: $name, description: $description, kind: $kind}` `` |

### Why this is safe

- `MERGE (n {id: $id})` matches any existing node with the given `id`, regardless
  of labels.
- `SET n:Codebase` is idempotent — adding a label a node already has is a no-op.
- `SET n:\`Class\`` is idempotent for the same reason.
- `SET n += $props` updates only the specified properties, preserving any
  existing ones.
- Net effect: existing nodes are upgraded in place; new nodes are created with
  all required labels. No constraint violations, no duplicate creation.

---

## Regression tests for Fix 2

### File

`tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs`

### Test cases to add

1. **Cypher-shell node path** — assert the generated node MERGE uses bare
   `{id: $id}` (not `Codebase {id: $id}`), and that `SET n:Codebase` and
   `SET n:\`<SecondaryLabel>\`` appear as separate clauses after the MERGE.

2. **Driver node path** — same assertions on the Bolt driver query string.

3. **Cypher-shell layer path** — assert the layer MERGE merges on `{id: ...}`
   only, with `SET l:Codebase SET l:Layer` as separate clauses.

4. **Driver layer path** — same for the Bolt driver query.

### Helper

A test helper `assertBareMergeId(query: string, secondaryLabel?: string)` will:

- Extract the `MERGE (n ... {id: ...})` clause via regex.
- Assert it does NOT contain `:Codebase {id:` or `:Layer {id:` (the composite
  label+id pattern is absent).
- If `secondaryLabel` is provided, assert `SET n:\`<secondaryLabel>\`` appears
  after the MERGE and is a separate `SET` clause.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing graphs have nodes missing the `Codebase` label; the fix changes which nodes get matched. | This is exactly the desired behavior. The fix upgrades such nodes in place. |
| A future change reverts Fix 2 silently. | Regression tests in Fix 2's test plan catch the composite-label pattern. |
| SKILL.md changes are policy-only; nothing enforces them at runtime. | This is intentional. The push script has no DELETE; the policy prevents ad-hoc destructive cypher. Future DELETE code in the script would need its own guard. |
| Fix 2 changes layer push behavior. | Layers use the same `{id}` constraint as nodes; the same bug class exists. Fix applies identically. |

## Success criteria

1. `push-codebase-graph.mjs` produces no composite-label MERGE patterns at any
   of the four target lines.
2. SKILL.md includes the prohibition (Fix 1), confirmation rule (Fix 3), and
   exact-ID scoping rule (Fix 4) in the specified locations.
3. The four new regression tests pass.
4. The existing test suite still passes.
5. A scoped `--files` run on the VENDOR-9410 investigation set, replayed
   against a graph with pre-existing nodes missing the `Codebase` label, no
   longer produces a constraint violation.

## Open questions

None. The user has approved all design choices.