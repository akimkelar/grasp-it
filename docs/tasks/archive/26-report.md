# Task 26 Completion Report: Auto-Flag Domain Graph as Stale After Codebase Update

## What Was Done

### 1. Added `domainGraphStale` field to `AnalysisMeta` type

**File:** `grasp-it-plugin/packages/core/src/types.ts`

Added optional `domainGraphStale?: boolean` to the `AnalysisMeta` interface (line ~140).

### 2. Updated `/grasp` Phase 7 SAVE to detect and flag domain graph staleness

**File:** `grasp-it-plugin/skills/grasp/SKILL.md`

Modified step 3 (write `meta.json`) to:
- After writing the base `meta.json`, read `domain-graph.json` (if it exists) and compare its `project.gitCommitHash` against the new commit hash
- If they differ, update `meta.json` to include `domainGraphStale: true`
- Print the warning: "Domain graph is out of sync with the updated codebase. Re-run `/grasp-domain` to refresh domain links."
- Optionally auto-trigger `/grasp-domain` if `config.json` has `autoUpdate: true`

### 3. Updated `/grasp-domain` Phase 1 to check and clear the staleness flag

**File:** `grasp-it-plugin/skills/grasp-domain/SKILL.md`

Replaced "Phase 1: Detect Existing Graph" with a new Phase 1 that:
- Reads `meta.json` for `domainGraphStale`
- If `domainGraphStale === false` and `--full` is NOT passed, reports "Domain graph is up to date" and exits early
- If `domainGraphStale === true` OR `--full` IS passed, proceeds with domain derivation
- After successful derivation, clears `domainGraphStale` by writing `meta.json` with `domainGraphStale: false`

### 4. Added unit tests

**File:** `grasp-it-plugin/packages/core/src/__tests__/domain-stale-flag.test.ts`

Tests cover:
- Setting `domainGraphStale: true` when domain graph commit differs from new commit
- NOT setting the flag when commits match
- Clearing the flag after successful `/grasp-domain` run
- Absent field treated as falsy
- No domain-graph.json means no staleness check

## Test Results

```
 ✓ src/__tests__/domain-stale-flag.test.ts (5 tests) 116ms
 Test Files  38 passed (38)
      Tests  802 passed (802)
```

All 802 tests pass. Lint was skipped due to a missing `eslint.config.js` file (pre-existing issue unrelated to this task).

## Files Changed

| File | Change |
|------|--------|
| `grasp-it-plugin/packages/core/src/types.ts` | Added `domainGraphStale?: boolean` to `AnalysisMeta` |
| `grasp-it-plugin/skills/grasp/SKILL.md` | Phase 7 now checks domain graph staleness and sets the flag |
| `grasp-it-plugin/skills/grasp-domain/SKILL.md` | Phase 0/1 now checks staleness flag and clears it after successful run |
| `grasp-it-plugin/packages/core/src/__tests__/domain-stale-flag.test.ts` | New test file for the flag cycle |