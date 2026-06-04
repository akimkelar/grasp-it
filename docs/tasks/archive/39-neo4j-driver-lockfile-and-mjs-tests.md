# Task 39: Update Lockfile and Add `.mjs` Integration Tests

## Background

`neo4j-driver: ^6.0.1` is declared in `grasp-it-plugin/package.json` under
`optionalDependencies`, but `pnpm-lock.yaml` has not been updated. Until the lockfile is
regenerated, `pnpm install --frozen-lockfile` (used in SKILL.md Phase 0) will fail or
ignore the new dependency.

Additionally, the three `.mjs` skill scripts (`save-project-meta.mjs`,
`load-project-meta.mjs`, `check-sync.mjs`) have no test coverage for their runtime
behavior — import resolution, graceful-skip, connection failure, and
`NEO4J_CONNECTION_TYPE` dispatch are all untested.

## Actions

### 39.1 Update `pnpm-lock.yaml`

Run `pnpm install` from `grasp-it-plugin/` to regenerate the lockfile with `neo4j-driver`
and its transitive dependencies. Verify `pnpm install --frozen-lockfile` passes afterwards.

Confirm `neo4j-driver` does NOT need an entry in `pnpm.onlyBuiltDependencies` — v6.x has
no native postinstall script.

### 39.2 Add `.mjs` script tests

Create tests (in `grasp-it-plugin/packages/core/src/__tests__/` or
`grasp-it-plugin/skills/grasp/__tests__/`) covering:

- `import("neo4j-driver")` succeeds from the `skills/grasp/` directory after `pnpm install`
  (module resolution smoke test — confirms the resolution chain works)
- `load-project-meta.mjs` outputs `{}` and exits 0 when no credentials are configured
- `save-project-meta.mjs` exits 0 (graceful skip) when no credentials are configured
- `check-sync.mjs` exits gracefully when no credentials are configured
- `save-project-meta.mjs` exits 1 when credentials are set but the database is unreachable
  (use `bolt://localhost:19999` or equivalent guaranteed-closed port)
- `NEO4J_CONNECTION_TYPE=cypher-shell` triggers the subprocess path, not the driver path
- Config priority: project `.env` takes precedence over `~/.grasp-it/neo4j.env`
- Global fallback: `~/.grasp-it/neo4j.env` is used when no project `.env` exists

## Acceptance Criteria

- `pnpm install --frozen-lockfile` passes from `grasp-it-plugin/`
- All 8 test scenarios above have coverage
- `pnpm test` passes
- Commit: `test: add integration tests for neo4j-driver .mjs scripts and update lockfile`
