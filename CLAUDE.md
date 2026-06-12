# grasp-it

## Project Overview
An open-source tool combining LLM intelligence + static analysis to produce a knowledge graph stored in Neo4j for understanding codebases.

## Prerequisites
- Node.js >= 22 (developed on v24)
- pnpm >= 10 (pinned via `packageManager` field in root `package.json`)

## Architecture
- **Monorepo** with pnpm workspaces
- **grasp-it-plugin/** — Claude Code plugin containing all source code:
  - **packages/core** — Shared analysis engine (types, persistence, tree-sitter, search, schema, tours, plugins)
  - **src/** — Skill TypeScript source for `/grasp`, `/grasp-diff`, `/grasp-explain`, `/grasp-domain`, `/grasp-gaps`, `/grasp-knowledge`, `/grasp-interview`, `/grasp-search`
  - **skills/** — Skill definitions (`/grasp`, `/grasp-diff`, `/grasp-explain`, `/grasp-domain`, `/grasp-gaps`, `/grasp-knowledge`, `/grasp-interview`, `/grasp-search`)
  - **agents/** — Agent definitions (project-scanner, file-analyzer, architecture-analyzer, tour-builder, graph-reviewer)

## Knowledge Graph

The project analyzes codebases and produces a structured knowledge graph stored in Neo4j:

- **[`docs/architecture/neo4j-schema.md`](docs/architecture/neo4j-schema.md)** — full schema design (databases, node labels, relationship types, mermaid diagrams, key query patterns, indexes)
- **[`docs/architecture/schema-evolution-plan.md`](docs/architecture/schema-evolution-plan.md)** — settled decisions and rationale, Groovy/Grails support tasks (G1–G6)

Supporting documentation:
- **[`docs/graph/architecture.md`](docs/graph/architecture.md)** — high-level graph overview and diagram
- **[`docs/graph/outdating-rules.md`](docs/graph/outdating-rules.md)** — detecting and resolving stale nodes
- **[`docs/graph/quality-rules.md`](docs/graph/quality-rules.md)** — quality dimensions and validation queries
- **[`docs/graph/seeding-rules.md`](docs/graph/seeding-rules.md)** — initial graph creation quality bar

## Agent Pipeline
- Agents write intermediate results to `.grasp-it/intermediate/` on disk (not returned to context)
- Agent model field is omitted from frontmatter so each platform falls back to its configured default — `inherit` was a Claude Code-only keyword that opencode (and similar tools) treated as a literal model id and rejected with `ProviderModelNotFoundError` (see #167)
- Intermediate files cleaned up after graph assembly
- **Investigation principle:** agents working over `docs/tasks/` should perform a broad search over the project's files first, to avoid missing related changes across the codebase

## Work on Tasks

The prompt alias **"work on tasks"** (used with `/loop work on tasks` or directly) triggers a sequential task implementation workflow:

1. **Pick next task:** List `docs/tasks/` directory (sorted alphabetically, files named `NNN-description.md`). Identify the first `.md` file that is NOT already in `docs/tasks/archive/`. When picking, only the file name determines eligibility — do not pre-read file content to evaluate or verify anything before spawning a sub-agent.

2. **Spawn sub-agent:** Launch a sub-agent with `run_in_background: true` and provide:
   - Path to the task file (e.g., `docs/tasks/02-project-cleanup.md`)
   - Context from `CLAUDE.md` (project overview, architecture, conventions, gotchas, key commands)

3. **Sub-agent completes the task:** The sub-agent reads the task file, does the work, creates a completion report at `docs/tasks/archive/NN-report.md` (same number as the task), then moves the original task file to `docs/tasks/archive/` using the `mv` command (archive by moving, NEVER delete the original from `docs/tasks/`), commits, and pushes.

4. **Report progress:** When the sub-agent completes, display a table summarizing completed tasks vs. remaining tasks (use file names from `docs/tasks/archive/` vs `docs/tasks/`).

5. **Continue:** Repeat from step 1 until all tasks are in `docs/tasks/archive/`.

## Key Commands
- `pnpm install` — Install all dependencies
- `pnpm --filter @grasp-it/core build` — Build the core package
- `pnpm --filter @grasp-it/core test` — Run core tests
- `pnpm --filter @grasp-it/skill build` — Build the plugin package
- `pnpm test` — Run all tests (skill tests live at repo-root `tests/skill/`, picked up by root `vitest.config.ts`)
- `pnpm lint` — Run ESLint across the project

## Conventions
- TypeScript strict mode everywhere
- Vitest for testing
- ESM modules (`"type": "module"`)
- Knowledge graph lives in a Neo4j database (see [`docs/architecture/neo4j-schema.md`](docs/architecture/neo4j-schema.md))
- Core uses subpath exports (`./search`, `./types`, `./schema`) to avoid pulling Node.js modules into browser

## Gotchas
- **tree-sitter**: Uses `web-tree-sitter` (WASM) instead of native `tree-sitter` — native bindings fail on darwin/arm64 + Node 24

## Versioning

Versions are tracked in the individual package.json files:
- `grasp-it-plugin/package.json` → `"version"` field
- `grasp-it-plugin/packages/core/package.json` → `"version"` field

All packages start at `0.1.0`. Semantic versioning begins at first official release.

## Testing Local Plugin Changes

Claude Code caches installed plugins at `~/.claude/plugins/cache/grasp-it/grasp-it/<version>/`. Symlinks don't work because Claude's Search/Glob tools can't follow them. To test local changes:

1. **Build the packages:**
   ```bash
   pnpm --filter @grasp-it/core build
   pnpm --filter @grasp-it/skill build
   ```

2. **Find the installed version** (must match what the marketplace currently serves):
   ```bash
   ls ~/.claude/plugins/cache/grasp-it/grasp-it/
   ```

3. **Copy your local plugin into the cache**, replacing `<VERSION>` with the version from step 2:
   ```bash
   rm -rf ~/.claude/plugins/cache/grasp-it/grasp-it/<VERSION>
   cp -R ./grasp-it-plugin ~/.claude/plugins/cache/grasp-it/grasp-it/<VERSION>
   ```

4. **Start a fresh Claude Code session** (existing sessions cache the old prompts in context).

5. **Run `/grasp --full`** in the target project to verify.

**Re-sync after further changes:**
```bash
pnpm --filter @grasp-it/core build && \
cp -R ./grasp-it-plugin/* ~/.claude/plugins/cache/grasp-it/grasp-it/<VERSION>/
```

**To revert to upstream:** Uninstall and reinstall the plugin from the marketplace — it repopulates the cache from the upstream repo.
