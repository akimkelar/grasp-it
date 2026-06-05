# Task 45 Report: Add missing knowledge node prefixes to `normalize-graph.ts`

## Summary

Added 9 missing knowledge node prefixes to `normalize-graph.ts` to ensure proper ID normalization for knowledge nodes produced by `/grasp-requirements` and `/grasp-domain`.

## Changes Made

Modified `grasp-it-plugin/packages/core/src/analyzer/normalize-graph.ts`:

1. **`VALID_PREFIXES` set** — Added: `feature`, `operation`, `actor`, `business-rule`, `entity`, `decision`, `constraint`, `claim`, `risk`

2. **`TYPE_TO_PREFIX` record** — Added mappings for all 9 new types (matching their ID prefixes exactly)

3. **`PREFIX_TO_TYPE` record** — Added reverse mappings for all 9 new types to enable type inference from ID prefixes

## Verification

- Build: `pnpm --filter @grasp-it/core build` — PASSED
- Tests: `pnpm --filter @grasp-it/core test` — 819 tests PASSED

## Acceptance Criteria Met

| Criterion | Status |
|-----------|--------|
| `pnpm --filter @grasp-it/core build` passes | Done |
| `pnpm --filter @grasp-it/core test` passes | Done |
| `risk:invoice-rounding` with type `risk` accepted | Done |
| `claim:a1b2c3` with type `claim` accepted | Done |
| `decision:jwt-memory-only` with type `decision` accepted | Done |
| No previously valid node IDs rejected | Done |

## Knowledge Node Prefixes Added

| Type | Prefix |
|------|--------|
| feature | feature: |
| operation | operation: |
| actor | actor: |
| business-rule | business-rule: |
| entity | entity: |
| decision | decision: |
| constraint | constraint: |
| claim | claim: |
| risk | risk: |

Note: `domain` and `concept` were already present in the file and required no changes.