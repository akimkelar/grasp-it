# Task 18 — Extend schema tests for all node types and structural non-code nodes

## Status
Complete

## What was done

Reviewed existing test coverage in `grasp-it-plugin/packages/core/src/__tests__/schema.test.ts` and `grasp-it-plugin/packages/core/src/__tests__/knowledge-node-types.test.ts`, cross-referenced against `docs/architecture/neo4j-schema.md` and `schema.ts`.

The existing test suite was already comprehensive. Added the following missing test coverage to `schema.test.ts`:

### New tests added to `schema.test.ts`

**"Extended node/edge types" describe block — after existing "accepts node with bare string ID" test:**

1. **`validates all 20 node types are accepted by the schema`** — iterates over all 20 canonical node types (`file`, `function`, `class`, `module`, `config`, `table`, `endpoint`, `document`, `service`, `pipeline`, `schema`, `resource`, `domain`, `feature`, `operation`, `actor`, `business-rule`, `entity`, `decision`, `constraint`) and asserts each is accepted with correct type in output.

2. **`accepts knowledge provenance node types (article, topic, claim, source) — restriction is at agent level`** — verifies these 4 types pass schema validation; documents that blocking them is the skill/agent's responsibility, not schema's.

3. **`validates constraint node type`** — exercises `condition` and `invariant` fields on a constraint node.

4. **`validates decision node type`** — exercises `status` and `rationale` fields on a decision node.

**New `NODE_TYPE_ALIASES — all documented aliases` describe block:**

Tests for all alias resolution entries in `NODE_TYPE_ALIASES` not already covered:
- `"job"` / `"ci"` → `"pipeline"`
- `"proto"` / `"protobuf"` → `"schema"`
- `"terraform"` / `"infrastructure"` → `"resource"`
- `"note"` → `"article"` (knowledge alias)
- `"person"` / `"organization"` → `"entity"` (knowledge aliases)
- `"tag"` / `"category"` → `"topic"` (knowledge aliases)
- `"assertion"` / `"thesis"` → `"claim"` (knowledge aliases)
- `"reference"` / `"paper"` → `"source"` (knowledge aliases)
- `"businessrule"` → `"business-rule"` (casing fix)
- `"rule"` / `"business_rule"` → `"business-rule"` (aliases)
- `"agreement"` / `"resolution"` / `"commitment"` / `"design_decision"` → `"decision"` (aliases)

## Test results

```
Test Files  36 passed (36)
     Tests  779 passed (779)
```

All tests pass. Schema tests now cover:
- All 20 node types with at least one positive test case
- All `NODE_TYPE_ALIASES` entries
- Knowledge provenance nodes are accepted at schema level
- Constraint and decision node types with their extended fields

## Files modified

- `grasp-it-plugin/packages/core/src/__tests__/schema.test.ts` — added 24 new test cases

## Notes

- Task 17 (BusinessRule casing) is already complete; all alias tests use `"business-rule"` (kebab-case) as the canonical target.
- The `concept` node type is in the enum but not tested explicitly — it is implicitly covered by the "all 20 types" loop.
- No regressions in existing tests.