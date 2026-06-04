# Task 23 Completion Report: Wire Cosmetic vs. Structural Filter into Main Incremental Path

## What was done

### 1. Created `filter-structural-changes.mjs`

**File:** `grasp-it-plugin/skills/grasp/filter-structural-changes.mjs`

A new Node.js script that runs after Phase 0 identifies changed files and before Phase 2 dispatches `file-analyzer` agents. It reads the fingerprint baseline (`.grasp-it/fingerprints.json`) and classifies each changed file:

- **STRUCTURAL** (writes to `structural-changed-files.txt`): files with `NEW`, `DELETED`, or `STRUCTURAL` change levels — require LLM re-analysis
- **COSMETIC/NONE** (writes to `cosmetic-only-files.txt`): files with `COSMETIC` or `NONE` change levels — LLM re-analysis is skipped

The script uses `analyzeChanges()` from `@grasp-it/core` (same comparison logic as the auto-update path) and falls back to treating all files as STRUCTURAL if `fingerprints.json` does not exist (first run after upgrade).

**Graceful fallback logic:**
- No `changed-files.txt` → empty outputs, exit 0
- No `fingerprints.json` → all files go to `structural-changed-files.txt` (conservative)
- New files always classified as STRUCTURAL (existing behavior)
- Deleted files always classified as STRUCTURAL

### 2. Updated `SKILL.md` Phase 2 incremental update path

**File:** `grasp-it-plugin/skills/grasp/SKILL.md`

Added a filter step between generating `changed-files.txt` and running `compute-batches.mjs`:

```bash
node <SKILL_DIR>/filter-structural-changes.mjs $PROJECT_ROOT
```

Then `compute-batches.mjs` runs on `structural-changed-files.txt` (not the full `changed-files.txt`). Only structural-change files are dispatched to `file-analyzer` agents.

Cosmetic-only files are skipped for LLM re-analysis but their nodes in the existing graph are still removed during the incremental merge step (since they still appear in `changed-files.txt` for node cleanup purposes — the filter only gates LLM dispatch, not node cleanup).

### 3. Added unit tests

**File:** `grasp-it-plugin/packages/core/src/__tests__/filter-structural-changes.test.ts`

6 test cases covering:
- Graceful fallback to STRUCTURAL when `fingerprints.json` is missing
- Clean exit when `changed-files.txt` does not exist
- Clean exit when `changed-files.txt` is empty
- New file classified as STRUCTURAL (with file on disk)
- Deleted file classified as STRUCTURAL
- Usage error when no project root given

All 788 tests pass.

## Key design decisions

1. **Same fingerprint logic as auto-update**: The script uses `analyzeChanges()` from core, which is the same function used by the auto-update hook. Consistency is maintained.

2. **Conservative fallback**: If `fingerprints.json` is missing (first run after upgrade), all changed files are treated as STRUCTURAL — no existing behavior is broken.

3. **Exit code 0 always**: Cosmetic files are not errors; the script always exits 0 to avoid disrupting the skill pipeline.

4. **Info-level logging for cosmetic skips**: Cosmetic files are logged as `Info:` (not `Warning:`), matching the pattern in `compute-batches.mjs` where routine optimizations don't produce warnings.

## Files changed

| File | Change |
|------|--------|
| `grasp-it-plugin/skills/grasp/filter-structural-changes.mjs` | New |
| `grasp-it-plugin/skills/grasp/SKILL.md` | Updated Phase 2 incremental path |
| `grasp-it-plugin/packages/core/src/__tests__/filter-structural-changes.test.ts` | New test file |

## Test results

```
Test Files  37 passed (37)
     Tests  788 passed (788)
  Duration  3.10s
```