# Task 49 Report: Update tests for `kind`/`source`, `risk` node type, and new edge types

## Summary

Updated test files to cover the new `kind`/`source` properties, `risk` node type, and `has_risk`/`mitigated_by` edge types added in Task 43.

## Files Changed

### `grasp-it-plugin/packages/core/src/__tests__/knowledge-node-types.test.ts`

- Added `kind: "knowledge"` and `source: "code-analysis"` to all existing knowledge node fixtures (domain, feature, operation, actor, entity, business-rule)
- Added `source: "interview"` for nodes that would be produced by `/grasp-requirements`
- Added Risk node test with all required properties (`complexity`, `severity`, `probability`, `mitigation`, `scope`, `tags`)
- Added test for risk severity enum values (`low`, `medium`, `high`, `critical`)
- Added test for risk probability enum values (`low`, `medium`, `high`)
- Added tests for `has_risk` and `mitigated_by` edge types

### `grasp-it-plugin/skills/grasp-requirements/SKILL.md`

- Updated `/grasp-requirements` description to reflect new node types (`Risk`, `Concept`, `Claim`) and the gap-analysis loop

### `README.md`

- Updated the `/grasp-requirements` section to describe the new interview structure with `source: "interview"` tagging and new node types

## Verification

- `pnpm --filter @grasp-it/core test` — **824 tests passed**
- No failures

## Notes

The `complexity` field on Risk nodes is required (enum: `simple`, `moderate`, `complex`) and was missing from the agent's initial test fixtures — corrected to match the schema.
