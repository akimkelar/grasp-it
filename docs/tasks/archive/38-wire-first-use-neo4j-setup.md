# Task 38: Wire First-Use Neo4j Setup into the Skill Layer

## Background

`grasp-it-plugin/packages/core/src/neo4j-config.ts` exports `SETUP_PROMPTS`, `loadConfig`,
`saveConfig`, and `hasConfig` — but none of these are called by any skill or `.mjs` script.
When a user runs `/grasp` for the first time with no `.env` and no env vars, the skill
prints "No Neo4j configuration found" and continues silently. The user receives no guidance
and no graph data is written or read.

Additionally, the three `.mjs` scripts (`save-project-meta.mjs`, `load-project-meta.mjs`,
`check-sync.mjs`) each contain a duplicated inline `getNeo4jConfig()` function. A shared
`neo4j-config-loader.mjs` helper exists but is not imported by any of them.

## Actions

### 38.1 Implement first-use guided prompting in `grasp/SKILL.md`

In Phase 0, when `hasConfig(projectRoot)` returns false (no `.env`, no env vars, no global
config), prompt the user interactively for:

1. Connection type (driver recommended as default)
2. Neo4j URI (local: `bolt://localhost:7687`, Aura: `neo4j+s://...`)
3. Database name (default: `neo4j`)
4. Username
5. Password

Write the result using `saveConfig()` and add `.env` to `.gitignore` using
`ensureEnvInGitignore()` (both exported from `neo4j-config.ts`).

The prompting should work in Codex and Claude Code contexts where the LLM can ask the
user for input via its message interface.

### 38.2 Consolidate `.mjs` config loading

Import `neo4j-config-loader.mjs` in `save-project-meta.mjs`, `load-project-meta.mjs`, and
`check-sync.mjs` instead of each file's inline `getNeo4jConfig()` implementation. Verify
`neo4j-config-loader.mjs` is complete and correct (three-level fallback: env vars →
project `.env` → `~/.grasp-it/neo4j.env`) before switching the imports.

Remove the duplicated inline functions after the import is in place.

### 38.3 Add tests

- First-use flow: when no config exists, the guided prompting is triggered
- `saveConfig()` writes a valid `.env` file
- `ensureEnvInGitignore()` adds `.env` to `.gitignore` (and is idempotent on re-run)
- `neo4j-config-loader.mjs` three-level fallback behaves correctly

## Acceptance Criteria

- Running `/grasp` with no Neo4j config prompts the user for credentials and creates `.env`
- `.env` is added to `.gitignore` automatically on creation
- `save-project-meta.mjs`, `load-project-meta.mjs`, `check-sync.mjs` all import from
  `neo4j-config-loader.mjs` — no duplicated `getNeo4jConfig()` implementations
- Tests pass with `pnpm test`
- Commit: `feat: wire first-use Neo4j setup prompts into grasp skill`
