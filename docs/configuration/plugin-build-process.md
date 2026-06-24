# Building and Publishing a New Plugin Version

For information about supporting the plugin for different platforms, read [docs/configuration/plugin-platform-resolution.md](./plugin-platform-resolution.md).

## Version Control

The plugin version is controlled by **three files** that must be kept in sync:

| File | Version field | Notes |
|------|---------------|-------|
| `grasp-it-plugin/.claude-plugin/plugin.json` | `"version"` | **Primary** — what Claude Code's `/plugin update` checks |
| `grasp-it-plugin/package.json` | `"version"` | Skill package version (`@grasp-it/skill`) |
| `grasp-it-plugin/packages/core/package.json` | `"version"` | Core package version (`@grasp-it/core`) |

All three must be updated together. Claude Code reads `plugin.json`, not `package.json`.

## Build Steps

### 1. Prerequisites

- Node.js ≥ 22 (developed on v24; CLAUDE.md pins this).
- pnpm ≥ 10 (pinned via `packageManager` field in root `package.json`).

```bash
node --version    # v22+
pnpm --version    # 10+
```

### 2. Bump version in all three files

Set all three `version` fields to the new value. Increment:

- **Patch** (`0.11.x` → `0.11.x+1`) for fixes-only releases.
- **Minor** (`0.x.0` → `0.x+1.0`) when new features, schema additions, or new node types land.
- **Major** (`0.x.y` → `1.0.0`) only on breaking changes to the knowledge graph schema or skill contracts.

Files to edit:
- `grasp-it-plugin/.claude-plugin/plugin.json`
- `grasp-it-plugin/package.json`
- `grasp-it-plugin/packages/core/package.json`

### 3. Install + build

```bash
pnpm install
pnpm --filter @grasp-it/core build
pnpm --filter @grasp-it/skill build
```

Both builds must succeed with no TypeScript errors.

### 4. Run tests

```bash
# Core tests (always required)
pnpm --filter @grasp-it/core test

# Skill tests (run separately; some require a Neo4j instance)
pnpm test
```

Expected counts at the time of writing: **912 core tests** in 41 files; **~470 skill tests** across the `tests/` tree (skill-test count grows as new bug-fix regression tests land — see `tests/skill/grasp-interview/test_push_interview_graph_skill_bugs.test.mjs` for the pattern). A handful of skill tests exercise the real Neo4j driver and are skipped when `NEO4J_*` env vars are absent (the test files strip these via the `tests/setup.ts` bootstrap).

The 2 timeout-prone tests in `tests/skill/grasp/test_silent_exit_bugs.test.mjs` (real-network DNS retry probes) are slow but pre-existing; they should not block a release.

### 5. Commit and push

```bash
git add grasp-it-plugin/.claude-plugin/plugin.json \
        grasp-it-plugin/package.json \
        grasp-it-plugin/packages/core/package.json \
        # plus any doc updates bundled with this release
git commit -m "release: bump version to X.Y.Z"
git push origin main
```

Commit-message format used historically: `release: bump version to X.Y.Z` (Co-Authored-By line preserved). Do not amend a published release commit — create a new patch commit if a fix is needed post-push.

## Publishing

Claude Code's `/plugin update` will detect the new version if:

- `plugin.json` version is higher than the cached version in `~/.claude/plugins/cache/grasp-it/grasp-it/<version>/`.
- The commit lands on the default branch (`main`).

The marketplace currently serves from `main`; there is no separate publish step.

## Quick Reference

```bash
# Full release: bump → install → build → test → commit → push
# (assumes versions already bumped in the three files)

pnpm install && \
  pnpm --filter @grasp-it/core build && \
  pnpm --filter @grasp-it/skill build && \
  pnpm --filter @grasp-it/core test && \
  pnpm test && \
  git add -A && \
  git commit -m "release: bump version to X.Y.Z" && \
  git push origin main
```

## Testing Local Plugin Changes Before Release

Claude Code caches installed plugins at `~/.claude/plugins/cache/grasp-it/grasp-it/<version>/`. Symlinks do not work (Claude's Search/Glob tools do not follow them). To verify a release candidate against a target project:

1. Build the packages (`pnpm --filter @grasp-it/core build && pnpm --filter @grasp-it/skill build`).
2. Locate the installed version directory:
   ```bash
   ls ~/.claude/plugins/cache/grasp-it/grasp-it/
   ```
3. Replace the cached version with your local build:
   ```bash
   rm -rf ~/.claude/plugins/cache/grasp-it/grasp-it/<VERSION>
   cp -R ./grasp-it-plugin ~/.claude/plugins/cache/grasp-it/grasp-it/<VERSION>
   ```
4. Start a fresh Claude Code session (existing sessions cache old prompts in context).
5. Run `/grasp --full` in the target project.

To revert to upstream: uninstall and reinstall from the marketplace.

## Gotchas

- **tree-sitter**: this project uses `web-tree-sitter` (WASM), not the native `tree-sitter` package. Native bindings fail on `darwin/arm64` + Node 24.
- **Agent model field**: agents intentionally omit `model` from frontmatter so each platform falls back to its configured default. `inherit` is a Claude-Code-only keyword that other tools (`opencode` etc.) reject as a literal model id.
- **Knowledge graph schema changes**: when bumping schema (adding a node label, relationship type, or index), update both `docs/architecture/neo4j-schema.md` and `setup-neo4j-schema.cypher` in the same release. The schema is the contract downstream tools depend on.
- **Versions move independently**: the two `package.json` files can drift in theory (different release cadences) but in practice are kept in lockstep. Do not let them desynchronize.
- **PascalCase → kebab-case defence in depth**: `push-interview-graph.mjs` normalises PascalCase labels (e.g. `BusinessRule`) back to kebab-case internal types (`business-rule`) before the `TYPE_TO_LABEL` lookup. The normalisation is exercised by `test_push_interview_graph_skill_bugs.test.mjs` (BUG-01 regression). If you refactor the node-type pipeline, keep the `normaliseNodeType()` helper and the `TYPE_ALIASES` map — without them the LLM writing `"type": "BusinessRule"` into `pr-nodes.json` causes silent data loss.

## Troubleshooting

**Build fails with `Cannot find module 'web-tree-sitter'`:**
Run `pnpm install` from the repo root. The WASM bindings are a workspace dependency.

**Tests fail with `NEO4J_*` env-var errors:**
Skill tests that exercise the driver look for a reachable Neo4j. The test bootstrap (`tests/setup.ts`) strips `NEO4J_*` for tests that opt in to no-config mode; ensure your env is clean when running them.

**`pnpm: command not found` or wrong Node version:**
The repo pins Node 22+ and pnpm 10+. Use a version manager (`nvm`, `asdf`, etc.) that respects the root `packageManager` field.

**Claude Code does not pick up the new version after push:**
- Confirm `plugin.json` version is strictly higher than the cached version.
- Confirm the commit is on `main` (not a topic branch).
- Run `/plugin update` from inside Claude Code — the marketplace re-poll takes a moment.

**Interview nodes silently dropped (`Unknown node type 'BusinessRule'` in stderr):**
The push script `push-interview-graph.mjs` filters out nodes whose `type` value is not in `TYPE_TO_LABEL`. The `BusinessRule` → `business-rule` mapping is the most common miss — the Neo4j label is `BusinessRule` (PascalCase), but the JSON `type` field in `pr-nodes.json` must be kebab-case `business-rule`. The script normalises PascalCase inputs as a safety net, but the LLM should still be told to write kebab-case. If you see this warning in the push transcript, check `pr-nodes.json` for `BusinessRule` entries and re-run with `"type": "business-rule"`, or rely on the defence-in-depth normalisation that runs at the start of `pushInterviewGraph()`.
