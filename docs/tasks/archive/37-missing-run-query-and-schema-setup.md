# Task 37: Create Missing `run-query.mjs` and Automate Schema Setup

## Background

A full Neo4j integration audit found two critical gaps not covered by any existing task:

1. **`run-query.mjs` is referenced but does not exist.** Both `grasp-gaps/SKILL.md` (lines
   127, 149, 152) and `grasp-search/SKILL.md` call `node "$SKILL_DIR/run-query.mjs"` for
   driver-based Neo4j queries. The file is missing from
   `grasp-it-plugin/skills/grasp/`. This means both `/grasp-gaps` and `/grasp-search`
   cannot execute any Neo4j queries via the driver path — they fail silently or error.

2. **Neo4j schema setup (`setup-neo4j-schema.cypher`) is never invoked automatically.**
   The schema constraints and indexes are documented and the Cypher file exists, but nothing
   in the install scripts, SKILL.md Phase 0, or any `.mjs` script applies them. Users must
   run the schema manually or it is never applied, causing constraint-dependent queries and
   `MERGE` operations to behave incorrectly on first use.

## Actions

### 37.1 Create `run-query.mjs`

**File to create:** `grasp-it-plugin/skills/grasp/run-query.mjs`

This script is invoked by `grasp-gaps/SKILL.md` and `grasp-search/SKILL.md` to run
arbitrary Cypher queries against Neo4j and return results. Implement it to:

1. Accept arguments: `<project-root> <cypher-query>` (check how the calling skills invoke
   it — read the exact invocation at lines 127, 149, 152 of `grasp-gaps/SKILL.md` and the
   equivalent in `grasp-search/SKILL.md` to determine the exact argument contract)
2. Load Neo4j credentials using the shared `neo4j-config-loader.mjs` (same three-level
   fallback as the other `.mjs` scripts)
3. Respect `NEO4J_CONNECTION_TYPE`: use `neo4j-driver` when `driver`, spawn `cypher-shell`
   subprocess when `cypher-shell`, graceful skip with message when `mcp`
4. Execute the provided Cypher query
5. Print results as JSON to stdout
6. Exit 0 on success or no-config skip; exit 1 on connection/query failure
7. Use the same defensive `try/catch` pattern around `import("neo4j-driver")` as the
   other `.mjs` scripts

Before implementing, read the calling sites carefully to confirm the exact argument format,
expected output format, and any environment variables the calling skill sets before invoking
the script.

### 37.2 Apply Neo4j schema on first use

**Context:** `grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher` defines constraints
and indexes. Currently nothing applies them automatically. A user who sets up Neo4j
credentials and runs `/grasp` for the first time will hit schema-dependent operations
(`MERGE` with unique constraints, index-backed lookups) without the schema being present.

Implement automatic schema application:

- In `grasp/SKILL.md` Phase 0, after credentials are confirmed present, add a step that
  runs the schema setup if it has not been applied yet
- Detect "already applied" idempotently — either check for the existence of a known
  constraint/index via a Cypher query, or use a sentinel node/property in Neo4j
- The schema Cypher already uses `IF NOT EXISTS` so re-running it is safe; the check is
  only to avoid the overhead of running it on every `/grasp` invocation
- Support both connection types: driver path (via a new `.mjs` helper or `run-query.mjs`)
  and `cypher-shell` path

### 37.3 Add tests for `run-query.mjs`

- Script exits 0 with empty results when no credentials are configured
- Script exits 0 and returns expected JSON when run against a live Neo4j instance (or a
  mock) with a valid query
- Script exits 1 when credentials are set but the database is unreachable
- Script output format matches what `grasp-gaps/SKILL.md` and `grasp-search/SKILL.md`
  expect (verify by reading those calling sites)

## Acceptance Criteria

- `grasp-it-plugin/skills/grasp/run-query.mjs` exists and is callable with the argument
  contract expected by `grasp-gaps/SKILL.md` and `grasp-search/SKILL.md`
- `/grasp-gaps` and `/grasp-search` can execute Neo4j queries via the driver path without
  errors
- Running `/grasp` on a fresh Neo4j instance applies the schema constraints automatically
  before any write operations
- Re-running `/grasp` does not re-apply the schema on every invocation
- Tests cover the scenarios in 37.3
- `pnpm test` passes
- Commit message: `feat: add run-query.mjs and automate Neo4j schema setup on first use`
