# Task 17 Completion Report: Fix BusinessRule Internal Type Casing

## Summary

Fixed the `BusinessRule` internal type casing issue in `schema.ts`, aligning it with the kebab-case convention used by all other node types.

## Changes Made

### 1. `grasp-it-plugin/packages/core/src/schema.ts`
- Changed `GraphNodeSchema.type` z.enum from `"BusinessRule"` to `"business-rule"`
- Updated `NODE_TYPE_ALIASES` targets:
  - `businessrule: "BusinessRule"` → `businessrule: "business-rule"`
  - `rule: "BusinessRule"` → `rule: "business-rule"`
  - `business_rule: "BusinessRule"` → `business_rule: "business-rule"`

### 2. `grasp-it-plugin/packages/core/src/types.ts`
- Changed `NodeType` union type from `"BusinessRule"` to `"business-rule"`

### 3. `grasp-it-plugin/packages/core/src/__tests__/knowledge-node-types.test.ts`
- Updated fixture node `type: "BusinessRule"` → `type: "business-rule"`
- Updated assertion `expect(brNode!.type).toBe("BusinessRule")` → `expect(brNode!.type).toBe("business-rule")`

### 4. `grasp-it-plugin/packages/core/src/__tests__/domain-types.test.ts`
- Updated fixture node `type: "BusinessRule"` → `type: "business-rule"`

### 5. `grasp-it-plugin/packages/core/dist/types.d.ts` and `schema.d.ts`
- Regenerated via `pnpm --filter @grasp-it/core build`

## Verification

- All 753 tests pass (`pnpm --filter @grasp-it/core test`)
- Build completes successfully (`pnpm --filter @grasp-it/core build`)
- Alias inputs (`"businessrule"`, `"rule"`, `"business_rule"`) still resolve correctly to `"business-rule"`
- `toNeo4jLabel("business-rule")` returns `"BusinessRule"` (unchanged, correct Neo4j label conversion)

## Acceptance Criteria Met

- `schema.ts` enum contains `"business-rule"`, not `"BusinessRule"`
- All aliases now map to `"business-rule"`
- All tests pass
- Existing alias inputs still resolve correctly
- No `"BusinessRule"` string literal remains as an internal type value in production code (only in documentation, which is expected)