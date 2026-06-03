# Task 10: Update graph-reviewer Agent for New Schema

## Description

The `graph-reviewer` agent (`agents/graph-reviewer.md`) hard-codes the list of valid node
types and edge types that it validates against. After Task 5 updates the schema, the
`graph-reviewer` must be updated to validate against the new node types and relationships —
otherwise it will incorrectly reject valid `feature`, `actor`, `business-rule`, `operation`,
and `entity` nodes, and incorrectly accept invalid `flow`, `step` nodes.

## Pre-requisites

- Task 5 (schema node updates) must be complete

## Current state

The agent currently lists:

**Valid node types (16 total):**
`file`, `function`, `class`, `module`, `concept`, `config`, `document`, `service`, `table`,
`endpoint`, `pipeline`, `schema`, `resource`, `domain`, `flow`, `step`

**Valid node ID prefixes (16 total):**
Same list as node types.

**Valid edge types (29 total: 26 structural + 3 domain):**
Includes `contains_flow`, `flow_step`, `cross_domain` and does NOT include
`has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`,
`uses_entity`, `implemented_by`.

## Actions

### 10.1 Update valid node types list

**File:** `grasp-it-plugin/agents/graph-reviewer.md`

In "Check 1 -- Schema Validation (Critical)", update the valid node types to:

**Codebase nodes (7):** `file`, `function`, `class`, `module`, `config`, `table`, `endpoint`

**Knowledge nodes (8):** `domain`, `feature`, `actor`, `business-rule`, `operation`,
`entity`, `decision`, `constraint`

**Also kept for structural coverage (6):** `concept`, `document`, `service`, `pipeline`,
`schema`, `resource`

Remove `flow` and `step` from the list entirely.

Update the count in the heading from "16 valid node types" to "21 valid node types" (or
split the count into codebase/knowledge sections for clarity).

### 10.2 Update valid node ID prefixes

Update the valid ID prefix list to match the updated node types:
- Remove `flow:` and `step:` prefixes
- Add `feature:`, `actor:`, `business-rule:`, `operation:`, `entity:`, `decision:`,
  `constraint:` prefixes

### 10.3 Update valid edge types list

In "Check 1 -- Schema Validation (Critical)", update the valid edge types:

**Remove (deprecated domain relationships):**
`contains_flow`, `flow_step`, `cross_domain`

**Add (new knowledge relationships):**
`has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`,
`uses_entity`, `implemented_by`

Also add (PO interview relationships if not present):
`constrained_by`, `decides`

Update the count comment accordingly.

### 10.4 Update schema validation checks

Search the `graph-reviewer.md` for any validation checks that test for `flow` or `step`
node types specifically (e.g. "at least one flow per domain" type quality check) and either:
- Update to check for `feature` instead of `flow`
- Remove if the check no longer applies

Also add new quality checks appropriate for the new schema:
- "Every `Domain` has at least one `HAS_FEATURE` edge"
- "Every `Feature` has at least one `HAS_OPERATION` edge OR the feature has
  `status: planned`" (planned features may not yet have operations)
- "Every `Actor` is referenced by at least one `PERFORMED_BY` or `RESTRICTED_FOR` edge"
  (orphan actors indicate a graph assembly error)

### 10.5 Update `IMPLEMENTED_BY` status validation

Add a check in the edge property validation section that `IMPLEMENTED_BY` edges have a
`status` property with one of: `"legacy"`, `"target"`, `"shared"`, `"planned"`.

If the graph-reviewer validates the `status` property type, also update the valid status
enum for:
- `Feature.status` and `Operation.status`: `"planned"`, `"partial"`, `"implemented"`
- `BusinessRule.status`: `"active"`, `"deprecated"`, `"proposed"`
- `Decision.status`: `"draft"`, `"accepted"`, `"deprecated"`

## Completion

When complete:
- `graph-reviewer.md` accepts the new node types and rejects `flow`/`step`
- `graph-reviewer.md` accepts the new edge types and rejects the deprecated ones
- Quality checks reference `Feature` not `Flow`
- Commit with message: `feat: update graph-reviewer agent for new knowledge schema (Feature/Actor/BusinessRule/Operation/Entity)`
