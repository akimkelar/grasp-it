# Task 2: Project Cleanup

## Description

Fix stale configuration, outdated documentation, and version mismatches that accumulated during the rename from "Understand Anything" to "grasp-it".

## Actions

### 2.1 Fix pnpm-workspace.yaml

**File:** `pnpm-workspace.yaml`

Replace content:
```yaml
packages:
  - 'grasp-it-plugin/packages/*'
  - 'grasp-it-plugin'
```

Rationale: `grasp-it-plugin/` is the actual plugin directory. `homepage/` and `understand-anything-plugin/` do not exist.

### 2.2 Regenerate pnpm-lock.yaml

**Command:**
```bash
rm pnpm-lock.yaml
pnpm install
```

Rationale: Current lock file references non-existent packages from the old project state.

### 2.3 Update CLAUDE.md

**File:** `CLAUDE.md`

**Section "Versioning" (lines 45-53):** Remove or correct. The referenced directories (`.claude-plugin/`, `.cursor-plugin/`, `.copilot-plugin/`) do not exist. Document the actual versioning approach or note that versioning is not yet implemented.

**Section "Project Overview" (line 4):** Update tagline to reference "grasp-it" explicitly if it doesn't already.

**Section "Architecture" (line 12):** Confirm `grasp-it-plugin/` description is accurate.

### 2.4 Reset Version Numbers

**Context:** Core is at `0.1.0` while Skill is at `2.7.5`. This is backwards — core should typically be at or above skill version. Since no versions have been formally released yet, reset both to a consistent starting point.

**Files:**
- `grasp-it-plugin/package.json` — set `"version"` to `"0.1.0"`
- `grasp-it-plugin/packages/core/package.json` — already `"0.1.0"` — confirm

Rationale: A new project should start at `0.1.0` across all packages. Semantic versioning can begin from `1.0.0` at first official release.

### 2.5 Verify No Old Name References Remain

**Command:** Search for any remaining "understand anything" (case-insensitive) across all files:
```bash
grep -ri "understand anything" --include="*.md" --include="*.yaml" --include="*.json" --include="*.ts" --include="*.js" .
```

Fix any remaining occurrences.

## Completion

When complete:
- pnpm-workspace.yaml points only to existing directories
- pnpm-lock.yaml regenerated cleanly with no stale references
- CLAUDE.md reflects actual project structure
- Versions reset to `0.1.0` consistently
- No remaining "Understand Anything" references
- Commit with message: `chore: project cleanup — workspace, lock file, CLAUDE.md, versions`
- Push to remote