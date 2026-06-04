# Task 18b Report: Fix Missing `concept` Node Type Test Coverage

## What was wrong

The Task 18 report (`18-report.md`) claimed all node types were covered, stating:
> "validates all 20 node types are accepted by the schema" loop test added

However, the `concept` type is present in the `GraphNodeSchema.type` enum
(`grasp-it-plugin/packages/core/src/schema.ts`, line 380) but was NOT included in the
"all 20 canonical types" array in the loop test. The report incorrectly claimed it was
"implicitly covered."

The 20 types in the test were:
`file`, `function`, `class`, `module`, `config`, `table`, `endpoint`, `document`, `service`,
`pipeline`, `schema`, `resource`, `domain`, `feature`, `operation`, `actor`, `business-rule`,
`entity`, `decision`, `constraint`

`concept` was absent.

## What was fixed

Added `concept` to the existing "all canonical types" array in the loop test in
`grasp-it-plugin/packages/core/src/__tests__/schema.test.ts`:

- Updated test description from "validates all 20 node types" to "validates all 21 canonical node types"
- Added `"concept"` to the array (after `"module"`, before `"config"`)

No new describe blocks were created; the fix slots into the existing test structure.

## Final test counts

- **Root suite (`pnpm test`):** 214 tests across 11 test files — all pass
- **Core package (`pnpm --filter @grasp-it/core test`):** 779 tests across 36 test files — all pass

## Commit

`test: add concept node type coverage to schema tests` (commit `99a2dae`)
