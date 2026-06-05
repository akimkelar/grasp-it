# Task 41: Fix Missing `PROJECT_SINGLETON_ID` in `check-sync.mjs`

## Background

Task 38 validation found a critical bug: `check-sync.mjs` references `PROJECT_SINGLETON_ID`
at lines 130 and 155 but the constant is never declared in the file. This causes a
`ReferenceError` at runtime whenever the script attempts to query Neo4j.

Both `save-project-meta.mjs` (line 35) and `load-project-meta.mjs` (line 30) define the
constant correctly as `"project:singleton"`.

## Action

**File:** `grasp-it-plugin/skills/grasp/check-sync.mjs`

Add the missing constant declaration alongside the other imports at the top of the file:

```js
const PROJECT_SINGLETON_ID = "project:singleton";
```

Place it near the existing imports (around line 26–27), consistent with how the other two
scripts declare it.

## Acceptance Criteria

- `check-sync.mjs` declares `PROJECT_SINGLETON_ID = "project:singleton"`
- The script no longer throws `ReferenceError` when querying Neo4j
- `pnpm test` passes
- Commit: `fix: add missing PROJECT_SINGLETON_ID constant in check-sync.mjs`
