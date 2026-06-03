# Task 1: Rename "Understand Anything" → "grasp-it"

## Description

The project was previously branded "Understand Anything". It has been renamed to "grasp-it". All references to the old name must be updated.

## Actions

1. **CLAUDE.md** (line 1):
   - `# Understand Anything` → `# grasp-it`

2. **grasp-it-plugin/agents/graph-reviewer.md** (line 10):
   - `"Understand Anything analysis pipeline"` → `"grasp-it analysis pipeline"`

3. **pnpm-workspace.yaml** (lines 1-4):
   - Replace `understand-anything-plugin` with `grasp-it-plugin`
   - Remove `homepage` reference (directory does not exist)

4. **pnpm-lock.yaml**:
   - Delete and re-generate via `pnpm install` after fixing workspace.yaml

5. **grasp-it-plugin/package.json** (name field):
   - Already `@grasp-it/skill` — confirm no old name references

6. **grasp-it-plugin/packages/core/package.json** (name field):
   - Already `@grasp-it/core` — confirm no old name references

## Completion

When complete:
- All references to "Understand Anything" removed
- pnpm-lock.yaml regenerated cleanly
- Commit with message: `rename: remove "Understand Anything" branding, update to "grasp-it"`
- Push to remote