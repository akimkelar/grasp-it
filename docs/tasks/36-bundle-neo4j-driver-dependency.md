# Task 36: Bundle neo4j-driver and Fix the Driver Integration Chain

## Background

Three skill scripts (`save-project-meta.mjs`, `load-project-meta.mjs`, `check-sync.mjs`)
already use `neo4j-driver` via defensive dynamic import — they wrap `import("neo4j-driver")`
in try/catch and degrade gracefully when the package is absent. However, a full integration
chain audit revealed that the driver path is completely broken end-to-end:

1. `neo4j-driver` is not declared in any `package.json` → `pnpm install` never installs it
   → the dynamic import always fails silently → Neo4j is never queried or written
2. `NEO4J_CONNECTION_TYPE` is never read by any `.mjs` script — there is no dispatch between
   `driver`, `cypher-shell`, and `mcp` at runtime
3. The global config (`~/.grasp-it/neo4j.env`) is silently ignored by direct script
   invocations (only works when SKILL.md Phase 0 has `source`d it into the environment first)
4. `check-sync.mjs` uses `process.cwd()` instead of `projectRoot` to locate `.env`,
   causing it to read the wrong config file if invoked from a different directory

A user with valid credentials and `NEO4J_CONNECTION_TYPE=driver` sees no error and no data
is ever written to or read from Neo4j. The fix requires declaring the package dependency,
adding the missing dispatch logic, and fixing the two config-loading bugs.

## Actions

### 36.1 Add `neo4j-driver` to `optionalDependencies`

**File:** `grasp-it-plugin/package.json`

Add:
```json
"optionalDependencies": {
  "neo4j-driver": "^6.0.1"
}
```

Use `optionalDependencies` (not `dependencies`) to match the existing graceful-skip behavior
of the scripts — if the install fails for any reason, `pnpm install` does not error out.

`@grasp-it/core` (`packages/core/package.json`) should NOT gain this dependency — core is
intentionally kept free of Node-only I/O modules and uses a duck-typed session interface in
`persistence/index.ts`.

### 36.2 Update the lockfile

Run `pnpm install` from the `grasp-it-plugin/` directory to update `pnpm-lock.yaml` with
`neo4j-driver` and its transitive dependencies (`neo4j-driver-core`,
`neo4j-driver-bolt-connection`, `rxjs`).

Verify that `neo4j-driver` does NOT appear in `pnpm.onlyBuiltDependencies` in the root
`package.json` — `neo4j-driver` 6.x has no native postinstall script.

### 36.3 Add `CONNECTION_TYPE` dispatch to the `.mjs` scripts

**Files:** `save-project-meta.mjs`, `load-project-meta.mjs`, `check-sync.mjs`

All three scripts currently ignore `NEO4J_CONNECTION_TYPE` and always attempt the
`neo4j-driver` path. Add dispatch logic to each script:

- When `NEO4J_CONNECTION_TYPE=driver` (or unset, after 36.4 changes the default): use the
  existing `neo4j-driver` dynamic import path
- When `NEO4J_CONNECTION_TYPE=cypher-shell`: invoke `cypher-shell` subprocess to run the
  same query (consistent with how `grasp-search` and `grasp-gaps` already work)
- When `NEO4J_CONNECTION_TYPE=mcp`: out of scope for now — treat as a graceful skip with
  an explanatory message

The dispatch should read `process.env.NEO4J_CONNECTION_TYPE` (populated by SKILL.md Phase 0
sourcing `.env`, or set directly by the user).

### 36.4 Change default connection type to `driver`

**File:** `grasp-it-plugin/packages/core/src/neo4j-config.ts`

Change `DEFAULTS.CONNECTION_TYPE` from `"cypher-shell"` to `"driver"`. After this task,
`driver` requires no Java, no extra CLI tools, and no manual installation — it is the correct
default for non-developer Codex/ChatGPT users.

Also reorder the `SETUP_PROMPTS.CONNECTION_TYPE` option list so `driver` appears first as
the recommended choice.

### 36.5 Add global config fallback to `.mjs` scripts

**Files:** `save-project-meta.mjs`, `load-project-meta.mjs`, `check-sync.mjs`

The `getNeo4jConfig()` inline function in each script only checks env vars and
`<projectRoot>/.env`. It does not check `~/.grasp-it/neo4j.env`. This means users who store
credentials in the global config only get them when SKILL.md Phase 0 has `source`d the file
into the shell environment — direct invocations (as documented in the docs) silently ignore
it.

Update `getNeo4jConfig()` in all three scripts to implement the same three-level priority
as `neo4j-config.ts`: env vars → `<projectRoot>/.env` → `~/.grasp-it/neo4j.env`.

Consider extracting a shared `getNeo4jConfig()` helper module (e.g.,
`skills/grasp/neo4j-config-loader.mjs`) so the logic is not duplicated across three files.

### 36.6 Fix `check-sync.mjs` `.env` resolution

**File:** `grasp-it-plugin/skills/grasp/check-sync.mjs`

`getNeo4jConfig()` reads `join(process.cwd(), ".env")` instead of
`join(projectRoot, ".env")` where `projectRoot = process.argv[2]`. If the script is invoked
from a directory other than `$PROJECT_ROOT` (as is common in Codex/Claude Code agent
contexts), it reads the wrong `.env` file and silently gets no credentials.

Fix: use `process.argv[2]` (consistent with `load-project-meta.mjs` and
`save-project-meta.mjs`).

### 36.7 Verify module resolution path

Confirm the Node.js bare-specifier resolution works from the `skills/grasp/` directory:
Node walks `skills/grasp/node_modules/` → `skills/node_modules/` → `<PLUGIN_ROOT>/node_modules/`.
Since `neo4j-driver` is declared in `<PLUGIN_ROOT>/package.json`, it installs at
`<PLUGIN_ROOT>/node_modules/neo4j-driver` — within the resolution chain.

Confirm by running one of the scripts without credentials and verifying the import succeeds
but gracefully skips (exit 0, no module-not-found error).

### 36.8 Add/update tests

**New tests:**

- `neo4j-driver` import succeeds after `pnpm install` (module resolution check)
- `save-project-meta.mjs` exits 0 with a skip message when no credentials are present
- `load-project-meta.mjs` outputs `{}` and exits 0 when no credentials are present
- `check-sync.mjs` falls back gracefully when no credentials are present
- `save-project-meta.mjs` exits 1 when credentials are present but the database is
  unreachable (e.g., `bolt://localhost:19999`)
- `check-sync.mjs` reads `.env` from `process.argv[2]` not `process.cwd()` (regression
  test for the bug fixed in 36.6)
- Config loading: global `~/.grasp-it/neo4j.env` is used when no project `.env` exists
- `CONNECTION_TYPE=cypher-shell` triggers the subprocess path, not the driver path

## Acceptance Criteria

- `neo4j-driver` appears in `grasp-it-plugin/package.json` as an `optionalDependency`
- `pnpm-lock.yaml` is updated and `pnpm install --frozen-lockfile` succeeds
- `NEO4J_CONNECTION_TYPE` is read and respected in all three `.mjs` scripts
- `DEFAULTS.CONNECTION_TYPE` is `"driver"` in `neo4j-config.ts`
- `check-sync.mjs` uses `projectRoot` (not `cwd`) for `.env` resolution
- All three scripts implement the three-level config fallback including `~/.grasp-it/neo4j.env`
- Running scripts with `CONNECTION_TYPE=driver` and valid credentials writes/reads Neo4j
- Running scripts without credentials exits 0 gracefully (not a module-not-found error)
- Tests cover all scenarios above
- Commit with message: `feat: wire neo4j-driver into integration chain and fix config loading bugs`
