# Task 37 Report: Create Missing `run-query.mjs` and Automate Schema Setup

## Summary

Implemented two missing Neo4j integration features:

1. **`run-query.mjs`** - A new script that executes arbitrary Cypher queries against Neo4j
2. **Automated Neo4j schema setup** - Added to Phase 0 of `/grasp` to apply schema constraints on first use

## Changes Made

### 37.1 Created `run-query.mjs`

**File:** `grasp-it-plugin/skills/grasp/run-query.mjs`

A new script that:
- Accepts `<project-root> <cypher-query>` as positional arguments
- Loads Neo4j credentials using the three-level fallback (env vars, project .env, ~/.grasp-it/neo4j.env)
- Respects `NEO4J_CONNECTION_TYPE`:
  - `driver` (default): Uses neo4j-driver with defensive import
  - `cypher-shell`: Spawns cypher-shell subprocess
  - `mcp`: Graceful skip (exit 0 with message)
- Executes the provided Cypher query and prints results as JSON to stdout
- Exit codes:
  - `0`: Success (or graceful skip when no config / MCP)
  - `1`: Connection/query failure
  - `2`: Driver signaled cypher-shell fallback (caller should fall back to cypher-shell)

### 37.2 Added Neo4j Schema Setup to Phase 0

**File:** `grasp-it-plugin/skills/grasp/SKILL.md` (lines ~156-220)

Added step 1.7 to Phase 0 after Neo4j config is loaded:
- Detects if schema is already applied by checking for `project_id` constraint
- Applies schema via driver path (using run-query.mjs line by line) or cypher-shell path
- Handles `mcp` connection type gracefully (skips with message)
- Uses `IF NOT EXISTS` guards for idempotency - re-running is safe
- Avoids overhead on every `/grasp` invocation by checking first

### 37.3 Added Tests

**File:** `tests/skill/grasp/test_run_query.test.mjs`

Comprehensive tests covering:
- No Neo4j config: exits 0 with empty results
- Missing arguments: exits 1 with usage error
- MCP connection type: exits 0 gracefully with skip message
- Driver with unreachable database: exits 2 (signals fallback)
- Cypher-shell with unreachable database: exits 1 (failure)
- Cypher-shell fallback when cypher-shell not available: exits 2
- Output format: valid JSON with results array
- Global config fallback via env vars

## Test Results

```
Test Files  14 passed (14)
Tests  253 passed (253)
```

All tests pass, including the 12 new tests for run-query.mjs.

## Files Modified/Created

| File | Status |
|------|--------|
| `grasp-it-plugin/skills/grasp/run-query.mjs` | Created |
| `grasp-it-plugin/skills/grasp/SKILL.md` | Modified |
| `tests/skill/grasp/test_run_query.test.mjs` | Created |

## Notes

- The lint command (`pnpm lint`) fails due to a pre-existing issue: no `eslint.config.js` file exists in the project (ESLint v9 requires this format)
- The schema setup step in SKILL.md uses shell loops to apply schema statements line-by-line via run-query.mjs for the driver path, since neo4j-driver doesn't support file-based query execution
