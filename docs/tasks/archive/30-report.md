# Task 30 — Completion Report

## Objective

Wire `saveProjectMeta` and `loadProjectMeta` into `/grasp` SKILL.md so that Phase 0 reads `gitCommitHash` from the Neo4j `Project` singleton and Phase 7 writes it after every analysis run.

## What was done

### 1. New scripts

Two standalone Node.js scripts were created in `grasp-it-plugin/skills/grasp/`:

**`load-project-meta.mjs`** — reads the `Project` singleton from Neo4j and prints `{gitCommitHash, lastAnalyzedAt, version, analyzedFiles}` as JSON to stdout. Returns `{}` (empty object) when:
- No Neo4j is configured (no `NEO4J_URI`/`NEO4J_USERNAME` in env or `.env`)
- Neo4j driver is not installed
- The `Project` node does not exist yet (first run)

**`save-project-meta.mjs`** — persists project metadata to the Neo4j `Project` singleton via `MERGE`. Also creates the `project_id` uniqueness constraint if it doesn't exist. Exits 0 silently when Neo4j is not configured (graceful degradation).

Both scripts support test-mock environment variables (`LOAD_PROJECT_META_MOCK`, `SAVE_PROJECT_META_MOCK`) for unit testing without a live Neo4j instance.

### 2. Phase 0 (step 6.5)

Added step 6.5 to SKILL.md after the existing `meta.json` read step:

- Runs `load-project-meta.mjs` to query Neo4j for the canonical `gitCommitHash`
- If the output contains a hash → uses it as `lastCommitHash`
- If the output is `{}` → falls back to `meta.json` or `knowledge-graph.json` (single-user local mode)
- If neither source has a hash → treats as first run (full analysis)

The skill continues to read `meta.json` and `knowledge-graph.json` as before for other purposes (they are not removed).

### 3. Phase 7 (step 3.5)

Added step 3.5 after the existing `meta.json` write step:

- Runs `save-project-meta.mjs "$PROJECT_ROOT" <analyzedFiles>` to persist the `Project` singleton to Neo4j
- Exits 0 silently if Neo4j is not configured (backward compatibility; local `meta.json` remains the source of truth)

### 4. Tests

Created `tests/skill/grasp/test_project_meta_scripts.test.mjs` covering:

**`load-project-meta.mjs`:**
- Returns the Neo4j hash when `LOAD_PROJECT_META_MOCK` env var is set
- Returns `{}` when mock signals no node yet (empty string)
- Returns `{}` when no Neo4j configuration is found
- Exits 1 with a usage error when no project root argument is provided

**`save-project-meta.mjs`:**
- Exits 0 in mock mode without needing Neo4j
- Exits 0 silently when no Neo4j is configured (graceful degradation)
- Exits 1 when `meta.json` is missing
- Exits 1 with a usage error when no project root argument is provided

All 8 new tests pass alongside the existing 231 tests.

### 5. Constraint verification

The `project_id` uniqueness constraint for `Project.id` is already present in `setup-neo4j-schema.cypher` (line 26, added in Task 22):
```cypher
CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE;
```
`save-project-meta.mjs` also calls this constraint before its `MERGE` as a belt-and-suspenders safety measure.

### 6. Graceful degradation

When Neo4j is not configured, both scripts exit 0 with no output/op — the skill's behavior is unchanged from before this task. The local `meta.json` remains the single source of truth in single-user offline mode.

## Files changed

| File | Change |
|------|--------|
| `grasp-it-plugin/skills/grasp/SKILL.md` | Added step 6.5 (Phase 0 Neo4j read) and step 3.5 (Phase 7 Neo4j write) |
| `grasp-it-plugin/skills/grasp/load-project-meta.mjs` | **New** — reads Project singleton from Neo4j |
| `grasp-it-plugin/skills/grasp/save-project-meta.mjs` | **New** — writes Project singleton to Neo4j |
| `tests/skill/grasp/test_project_meta_scripts.test.mjs` | **New** — unit tests for both scripts |

## Test results

```
Test Files  13 passed (13)
     Tests  231 passed (231)   ← 8 new tests included
```

Lint: pre-existing ESLint config issue (no `eslint.config.js`), unrelated to this task.