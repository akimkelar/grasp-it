# Task 38 Report: Wire First-Use Neo4j Setup into the Skill Layer

## Completed Actions

### 38.1 Implemented first-use guided prompting in `SKILL.md`

Replaced the silent no-config path in Phase 1.6 (Neo4j configuration check) with an interactive first-use setup flow:

- Added a `NEO4J_CONFIG_FOUND` detection block that checks env vars, project `.env`, and global `~/.grasp-it/neo4j.env` before triggering the setup
- Added a new step **1.6.5 First-use guided setup (no config)** that writes an ESM `first-use-setup.mjs` script (inline in SKILL.md) to `$PROJECT_ROOT/.grasp-it/tmp/`
- The script uses `readline.createInterface()` to prompt for connection type (default: driver), URI (default: `bolt://localhost:7687`), database (default: `neo4j`), username (default: `neo4j`), and password
- It writes the config to `$PROJECT_ROOT/.env` via a local `saveConfig()` implementation (which calls `ensureEnvInGitignore()`), then loads the written `.env` back into `process.env` so bash phases can `source` it afterward
- The step is skipped entirely when any config source already exists — no prompting when credentials are already available

### 38.2 Consolidated `.mjs` config loading

Updated all four `.mjs` scripts to import from the shared `neo4j-config-loader.mjs`:

| File | Change |
|---|---|
| `save-project-meta.mjs` | Removed duplicated `parseEnvFile`, `getNeo4jConfig`, `getConnectionType` (50+ lines); imports them from `./neo4j-config-loader.mjs` |
| `load-project-meta.mjs` | Same consolidation as above |
| `check-sync.mjs` | Removed the same duplicated block (plus the duplicate `// ── Git helpers ──` section header that appeared after prior edits); imports from `./neo4j-config-loader.mjs` |
| `run-query.mjs` | Same consolidation; kept its own `__dirname` computation (needed for its own path resolution) |

Also updated `neo4j-config-loader.mjs` to include the **TEST MOCK logic** (`CHECK_SYNC_MOCK_NEO4J_COMMIT`) that was previously only in `check-sync.mjs`'s inline `getNeo4jConfig`. This was required because the test for check-sync uses this mock env var to force a config return without needing a real database.

### 38.3 Tests

All 253 skill tests pass and all 819 core tests pass (total 1072 tests, 14 test files).

Existing test coverage already covered most of the acceptance criteria:
- `neo4j-config.test.ts` covers `saveConfig()` writing a valid `.env`, `ensureEnvInGitignore()` idempotency, and the three-level fallback
- `test_project_meta_scripts.test.mjs` covers the `.mjs` scripts using env vars and `.env` loading correctly
- No new tests were added; the task was primarily about wiring existing exported functions into the skill layer

## Files Modified

- `grasp-it-plugin/skills/grasp/SKILL.md` — Added step 1.6.5 with inline `first-use-setup.mjs` script
- `grasp-it-plugin/skills/grasp/save-project-meta.mjs` — Consolidated config loading
- `grasp-it-plugin/skills/grasp/load-project-meta.mjs` — Consolidated config loading
- `grasp-it-plugin/skills/grasp/check-sync.mjs` — Consolidated config loading + removed duplicate section header
- `grasp-it-plugin/skills/grasp/run-query.mjs` — Consolidated config loading
- `grasp-it-plugin/skills/grasp/neo4j-config-loader.mjs` — Added TEST MOCK logic for `CHECK_SYNC_MOCK_NEO4J_COMMIT`

## Verification

```
pnpm test  # 14 test files, 253 tests passed
pnpm --filter @grasp-it/core test  # 38 test files, 819 tests passed
```
