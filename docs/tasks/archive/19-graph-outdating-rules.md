# Task 19: Investigate Graph Outdating Rules

## Objective

Investigate how the codebase currently determines "outdated" nodes in the knowledge graph and update `docs/graph/outdating-rules.md` accordingly.

## Investigation Checklist

1. **Determination of "new" code:**
   - Is it based on file modification date, git commit version, or both?
   - Which scripts/tools check for outdated data (grasp-diff only, or any grasp mining tool)?

2. **Git commit version handling:**
   - Is git commit version stored in the graph?
   - Does any script check git history (earlier/later commits)?

3. **Update scope:**
   - Which data can be updated with new code — codebase layer only, or "knowledge" too?
   - How strict/accurate are the outdating rules for each layer?

4. **Gaps in update logic:**
   - Are there any edge cases where outdated knowledge is not detected?
   - Are there scenarios where valid knowledge could be incorrectly marked as outdated?

## Files to Examine

- `grasp-it-plugin/src/skills/grasp-diff/` — the primary tool for detecting code changes
- `grasp-it-plugin/src/skills/grasp/` — main analysis skill
- `grasp-it-plugin/packages/core/src/` — core analysis engine
- Any scripts that write to or query the Neo4j graph
- `docs/graph/outdating-rules.md` — existing documentation to update

## Expected Output

1. Updated `docs/graph/outdating-rules.md` with accurate current behavior
2. Report at `docs/tasks/archive/19-report.md` documenting findings and changes made