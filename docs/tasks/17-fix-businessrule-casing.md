# Fix BusinessRule internal type casing in schema.ts

## Status
open

## Reference documents

- Node type definitions and casing convention: `docs/architecture/neo4j-schema.md`
  (sections: "Labeling Convention → Internal type representation", "Node ID Conventions")
- Settled decision context: `docs/architecture/schema-evolution-plan.md`
  (section: "Final node set")

## Problem

In `grasp-it-plugin/packages/core/src/schema.ts`, the `GraphNodeSchema.type` enum contains
`"BusinessRule"` (PascalCase) as the canonical internal value, while every other node type uses
lowercase or kebab-case (`"file"`, `"function"`, `"domain"`, `"decision"`, etc.).

This happened because `sanitizeGraph` lowercases all input → `"BusinessRule"` becomes
`"businessrule"` → the alias system in `normalizeGraph` maps `"businessrule"` → `"BusinessRule"`.
So the PascalCase form ended up as the canonical enum value via the alias roundtrip.

The correct internal canonical form should be `"business-rule"` (kebab-case), consistent with:
- The ID convention: `business-rule:<kebab-name>` (already correct in `neo4j-schema.md`)
- All other node types in the enum
- The documentation in `neo4j-schema.md` Node ID Conventions table

## Changes required

**File:** `grasp-it-plugin/packages/core/src/schema.ts`

1. In `GraphNodeSchema.type` z.enum, change `"BusinessRule"` → `"business-rule"`
2. In `NODE_TYPE_ALIASES`, update targets that map to `"BusinessRule"`:
   - `businessrule: "BusinessRule"` → `businessrule: "business-rule"`
   - `rule: "BusinessRule"` → `rule: "business-rule"`
   - `business_rule: "BusinessRule"` → `business_rule: "business-rule"`
3. Search the entire codebase for string literals `"BusinessRule"` used as a node type value
   (not as a label name in documentation) and update them to `"business-rule"`.

## Impact

- `sanitizeGraph` already lowercases input, so `"BusinessRule"` input becomes `"businessrule"`,
  which the alias maps to the new `"business-rule"` canonical form — no behaviour change for callers.
- JSON graphs already in `.grasp-it/` on disk will have nodes with `type: "BusinessRule"`.
  The alias system handles backward compatibility transparently.
- Tests in `tests/skill/` and `grasp-it-plugin/packages/core/` that assert `type === "BusinessRule"`
  must be updated to assert `type === "business-rule"`.

## Acceptance criteria

- `schema.ts` enum contains `"business-rule"`, not `"BusinessRule"`
- All aliases that previously mapped to `"BusinessRule"` now map to `"business-rule"`
- All tests pass
- Existing alias inputs (`"businessrule"`, `"rule"`, `"business_rule"`) still resolve correctly
- No string `"BusinessRule"` remains as an internal type value in production code (docs are fine)
