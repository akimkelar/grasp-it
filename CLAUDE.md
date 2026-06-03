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
  - **src/** — Skill TypeScript source for `/grasp`, `/grasp-diff`, `/grasp-explain`, `/grasp-domain`, `/grasp-gaps`, `/grasp-knowledge`, `/grasp-po`, `/grasp-search`
  - **skills/** — Skill definitions (`/grasp`, `/grasp-diff`, `/grasp-explain`, `/grasp-domain`, `/grasp-gaps`, `/grasp-knowledge`, `/grasp-po`, `/grasp-search`)
  - **agents/** — Agent definitions (project-scanner, file-analyzer, architecture-analyzer, tour-builder, graph-reviewer)

## Knowledge Graph

The project analyzes codebases and produces a structured knowledge graph stored in Neo4j. See [`docs/architecture/neo4j-schema.md`](docs/architecture/neo4j-schema.md) for the Neo4j schema design (databases, node labels, relationship types) and mermaid diagrams.

## Agent Pipeline
- Agents write intermediate results to `.grasp-it/intermediate/` on disk (not returned to context)
- Agent model field is omitted from frontmatter so each platform falls back to its configured default — `inherit` was a Claude Code-only keyword that opencode (and similar tools) treated as a literal model id and rejected with `ProviderModelNotFoundError` (see #167)
- Intermediate files cleaned up after graph assembly

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

At this early stage, versioning is not yet formalized. All packages start at `0.1.0`.

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
