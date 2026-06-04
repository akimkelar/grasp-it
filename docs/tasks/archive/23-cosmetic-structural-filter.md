# Task 23: Wire Cosmetic vs. Structural Filter into Main Incremental Path

## Objective

Prevent unnecessary LLM re-analysis of files that changed cosmetically (comments, variable renames inside function bodies, whitespace). The fingerprint classifier already exists — this task wires it into `/grasp` Phase 2 before agents are dispatched.

## Background

See `docs/graph/outdating-rules.md` → "Gap 1".

The `classifyUpdate()` function in `grasp-it-plugin/packages/core/src/change-classifier.ts` returns `SKIP` for files that are `COSMETIC`-only according to `fingerprint.ts`. It is currently used only by the auto-update hook, not by the main incremental path. Every file in `changed-files.txt` — regardless of how trivial the change — currently triggers a `file-analyzer` LLM call.

## Implementation Checklist

### 1. Understand the existing classifier

- [ ] Read `grasp-it-plugin/packages/core/src/change-classifier.ts` — understand `classifyUpdate()` signature and return values
- [ ] Read `grasp-it-plugin/packages/core/src/fingerprint.ts` — understand `analyzeChanges()` and `ChangeLevel` (`NONE`, `COSMETIC`, `STRUCTURAL`)
- [ ] Read `grasp-it-plugin/skills/grasp/build-fingerprints.mjs` — understand how fingerprints are built from a file list

### 2. Add a filter script to the skill

- [ ] In `grasp-it-plugin/skills/grasp/`, create `filter-structural-changes.mjs` (or add logic to an existing phase script):
  - Input: `changed-files.txt` (list of files changed since last commit)
  - Load `fingerprints.json` from `.grasp-it/fingerprints.json` (if it exists)
  - For each changed file, call `analyzeChanges()` against the current file content and the stored fingerprint
  - Output two lists: `structural-changed-files.txt` (STRUCTURAL or NEW) and `cosmetic-only-files.txt` (COSMETIC or NONE)

### 3. Update SKILL.md Phase 2

- [ ] Open `grasp-it-plugin/skills/grasp/SKILL.md`
- [ ] In "Incremental update path", after building `changed-files.txt`, add a step:
  - Run `filter-structural-changes.mjs`
  - Dispatch `file-analyzer` agents only for `structural-changed-files.txt`
  - For `cosmetic-only-files.txt`: update only the `summary` field on existing nodes if needed, or skip entirely

### 4. Graceful fallback

- [ ] If `fingerprints.json` does not exist (first run after upgrade), treat all changed files as STRUCTURAL and proceed as before

### 5. Tests

- [ ] Add a unit test for `filter-structural-changes.mjs` (or the core function it calls) with a mock fingerprint store
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/packages/core/src/change-classifier.ts`
- `grasp-it-plugin/packages/core/src/fingerprint.ts`
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `grasp-it-plugin/skills/grasp/build-fingerprints.mjs`
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/23-report.md`
- [ ] Move this file to `docs/tasks/archive/23-cosmetic-structural-filter.md`
- [ ] Commit: `git add -A && git commit -m "feat: skip LLM re-analysis for cosmetic-only file changes in incremental path"`
- [ ] Push: `git push`
