# Shared Scripts Architecture

## Problem

Multiple skills shipped duplicate copies of the same scripts:

| Script | grasp | grasp-domain | grasp-gaps | grasp-search |
|--------|-------|--------------|------------|--------------|
| `neo4j-config-loader.mjs` | canonical | duplicate | duplicate | duplicate |
| `run-query.mjs` | canonical | duplicate | duplicate | duplicate |
| `load-project-meta.mjs` | canonical | duplicate | - | - |

This caused several issues:

1. **Divergent behavior**: Scripts were modified independently across skills, leading to subtle bugs. For example, `run-query.mjs` in `grasp-gaps` defaulted the cypher-shell database to `"neo4j"` while `grasp-domain` defaulted to `"grasp"`.

2. **Maintenance burden**: Bug fixes applied to one copy were not automatically propagated to others, requiring manual synchronization.

3. **Test duplication**: The test suite ran identical tests against every copy to ensure they stayed in sync, wasting CI time.

4. **Inconsistent behavior**: The `load-project-meta.mjs` in `grasp-domain` exited with code 1 on errors, while the `grasp` version exited gracefully with `{}`, causing different behavior in calling SKILL.md scripts.

## Solution

The `grasp` skill is the canonical source for shared scripts. Other skills reference these scripts via relative paths:

```bash
# From grasp-gaps or grasp-search SKILL.md:
GRASP_SKILL_DIR="$(cd "$(dirname "$0")/../grasp" && pwd)"
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN n"
```

```javascript
// From grasp-domain .mjs files:
import { getNeo4jConfig } from "../../grasp/neo4j-config-loader.mjs";
```

## Deleted Duplicates

| File | Reason |
|------|--------|
| `skills/grasp-domain/neo4j-config-loader.mjs` | Now uses `../../grasp/neo4j-config-loader.mjs` |
| `skills/grasp-domain/run-query.mjs` | Now uses `$GRASP_SKILL_DIR/run-query.mjs` |
| `skills/grasp-gaps/neo4j-config-loader.mjs` | Now uses `../grasp/neo4j-config-loader.mjs` |
| `skills/grasp-gaps/run-query.mjs` | Now uses `$GRASP_SKILL_DIR/run-query.mjs` |
| `skills/grasp-search/neo4j-config-loader.mjs` | Now uses `../grasp/neo4j-config-loader.mjs` |
| `skills/grasp-search/run-query.mjs` | Now uses `$GRASP_SKILL_DIR/run-query.mjs` |
| `skills/grasp-domain/load-project-meta.mjs` | Now uses `$GRASP_SKILL_DIR/load-project-meta.mjs` |

## Bug Fix: Consistent Default Database

Before this consolidation, `run-query.mjs` in `grasp-gaps` used `"neo4j"` as the default database for cypher-shell while the driver used `"grasp"`. This inconsistency was fixed — the canonical `grasp/run-query.mjs` now consistently defaults to `"grasp"` for both connection types.

## Updated SKILL.md Files

Skill markdown files were updated to use `$GRASP_SKILL_DIR` instead of `$SKILL_DIR` for script invocations:

- `grasp-domain/SKILL.md` — All `run-query.mjs` and `load-project-meta.mjs` calls now use `$GRASP_SKILL_DIR`
- `grasp-gaps/SKILL.md` — All `run-query.mjs` calls now use `$GRASP_SKILL_DIR`
- `grasp-search/SKILL.md` — All `run-query.mjs` calls now use `$GRASP_SKILL_DIR`

## Updated Tests

Test files were updated to only test the canonical scripts:

- `test_neo4j_config_loader.test.mjs` — Removed `grasp-domain` from test matrix
- `test_run_query.test.mjs` — Removed `grasp-search`, `grasp-gaps`, `grasp-domain` from test matrix
- `test_first_use_setup.test.mjs` — Removed `grasp-search`, `grasp-gaps` from test matrices
- `test_load_project_meta.test.mjs` — Removed `grasp-domain` from test matrix, cleaned up skip conditions

## Benefits

1. **Single source of truth**: All behavior changes are made in one place
2. **Consistent behavior**: All skills use the same script versions
3. **Reduced maintenance**: Bug fixes automatically apply to all skills
4. **Faster tests**: No longer testing duplicate copies
5. **Clear ownership**: The `grasp` skill owns these shared utilities
