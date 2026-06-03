# Extend schema tests for all node types and structural non-code nodes

## Status
open

## Reference documents

- Canonical node type definitions (all 20 types, ID patterns, casing): `docs/architecture/neo4j-schema.md`
  (sections: "Node Labels", "Structural Non-code Nodes", "Knowledge Provenance Nodes",
  "Deferred Node Types", "Node ID Conventions")
- Node type internal representation and casing convention: `docs/architecture/neo4j-schema.md`
  (section: "Labeling Convention → Internal type representation")
- Alias system: `grasp-it-plugin/packages/core/src/schema.ts` (`NODE_TYPE_ALIASES`, `EDGE_TYPE_ALIASES`)

## Context

The schema was recently updated with:
- New knowledge nodes: `Feature`, `Actor`, `BusinessRule`, `Operation`, `Entity` (Task 5)
- Structural non-code nodes now explicitly documented: `Document`, `Service`, `Pipeline`,
  `Schema`, `Resource`
- Knowledge provenance nodes reserved for `/grasp-knowledge`: `Article`, `Topic`, `Claim`, `Source`
- Deferred/optional node: `Concept`

Task 17 will rename the `"BusinessRule"` internal type to `"business-rule"`.

The current test suite needs to be reviewed to ensure coverage of all 20 node types and the
guard rules (e.g., wiki-only nodes must not be accepted from codebase agents).

## What to investigate first

Read the current test files to understand what's covered:
- `grasp-it-plugin/packages/core/src/__tests__/` (if it exists)
- `tests/skill/` at the repo root
- Any test files matching `*.test.ts` or `*.spec.ts` under `grasp-it-plugin/`

Run `pnpm test` to see current pass/fail status.

## Required test coverage

### `schema.ts` unit tests

1. **All 20 node types accepted** — `validateGraph` should accept a node for each of:
   `file`, `function`, `class`, `module`, `config`, `table`, `endpoint`,
   `document`, `service`, `pipeline`, `schema`, `resource`,
   `domain`, `feature`, `operation`, `actor`, `business-rule`, `entity`,
   `decision`, `constraint`

2. **Alias resolution** — `normalizeGraph` must resolve all aliases correctly:
   - `"BusinessRule"` / `"businessrule"` / `"rule"` / `"business_rule"` → `"business-rule"`
     (after Task 17; before Task 17, these map to `"BusinessRule"`)
   - `"doc"` / `"readme"` → `"document"`
   - `"container"` / `"deployment"` / `"pod"` → `"service"`
   - `"job"` / `"ci"` → `"pipeline"`
   - `"proto"` / `"protobuf"` → `"schema"`
   - `"infra"` / `"terraform"` → `"resource"`

3. **Unknown type dropped** — nodes with an unrecognised `type` must be dropped (not silently
   accepted due to `.passthrough()`) and produce a `"dropped"` issue.

4. **`sanitizeGraph` lowercasing** — all type strings are lowercased before validation.

5. **`autoFixGraph` defaults** — missing `complexity`, `tags`, `summary` are filled in.

6. **Knowledge provenance nodes not blocked by schema** — `Article`, `Topic`, `Claim`, `Source`
   are valid schema types (they exist for `/grasp-knowledge`), so `validateGraph` must accept them.
   The restriction is at the agent/skill level, not schema validation level.

### Integration tests (if applicable)

If there are tests that produce a full graph via a skill or agent mock, verify that:
- `Domain → Feature → Operation` hierarchy validates end-to-end
- `IMPLEMENTED_BY` edges between knowledge and codebase nodes are accepted
- Structural non-code nodes (`Document`, `Service`, etc.) appear in a realistic codebase graph

## Acceptance criteria

- `pnpm test` passes with all 20 node types having at least one positive test case
- Alias resolution for all entries in `NODE_TYPE_ALIASES` is tested
- No test asserts `type === "BusinessRule"` after Task 17 is complete (use `"business-rule"`)
- Test file(s) are co-located with `schema.ts` or in `tests/` with clear naming

## Dependencies

- Task 17 (BusinessRule casing) should be done first, or tests should account for the
  pre-Task-17 state and be updated atomically with the casing change.
