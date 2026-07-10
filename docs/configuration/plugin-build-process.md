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

Expected counts: **918 core tests** in 41 files (`pnpm --filter @grasp-it/core test`); **758 skill / installer tests** in 43 files across the `tests/` tree (`pnpm test`). The skill count grows as new bug-fix regression tests land — see `tests/skill/grasp-concept/test_push_concept_graph_skill_bugs.test.mjs` for the pattern. A handful of skill tests exercise the real Neo4j driver and are skipped when `NEO4J_*` env vars are absent (the test files strip these via the `tests/setup.ts` bootstrap).

**Test-count history (skill/installer totals across recent releases):**

| Release | Tests | Files | Note |
|---|---|---|---|
| v0.13.4 | 601 | 35 | Pre-freshness-refactor baseline |
| v0.13.5 | 688 | 40 | Added freshness-refactor regression suite (no-global-freshness-check, grasp-freshness skill, grasp-diff scope check, run-query driver params) |
| v0.13.6 | 671 | 39 | Skill consolidation: removed `src/__tests__/context-builder.test.ts` (~17 tests) as part of retiring `/grasp-chat`; `/grasp-explain`'s test surface stayed constant at 8 tests in `explain-builder.test.ts` because `/grasp-search` now owns the graph-lookup behaviour |
| v0.13.7 | 671 | 39 | No test-surface changes; dependency bump + bug fixes |
| v0.13.8 | 671 | 39 | No test-surface changes; doc + release plumbing |
| v0.13.9 | 679 | 40 | Added MERGE-on-bare-id regression suite (4 tests in `test_push_codebase_graph_cypher_bugs.test.mjs`) + 1 new behavioural timeout test (`test_push_codebase_graph_timeout.test.mjs`) + IN_LAYER MATCH fixes; 3 pre-existing layer tests in `test_push_codebase_graph_layers.test.mjs` updated to match the new bare-id MERGE pattern |
| v0.13.10 | 758 | 43 | BUG-01–04 fixes from `~/.grasp-it/bug-reports/2026-07-10_11-16_grasp-report-bug.md`: cypher-shell `--format json` → `--format plain` with parser + 11 integration / 36 unit tests; concept-node SKILL.md schema-truth fix + 26 `buildNodesCypher` regression tests; `--files` scope and verbatim-file-analyzer wording + 4 `file-analyzer.md` invariant tests; post-push orphan-detection step in Phase 6 + 7 bash-regression tests; also fixed the latent Python `IndentationError` in the orphan-check bash block (silent `2>/dev/null` fallback had masked it — replaced with `grep -oE` extraction); also fixed env-var leak in 6 `runPush*Graph` test helpers (was treating `NEO4J_URI=''` as a real value, causing parallel-test flakes) |

A small number of skill tests rely on real-network DNS probes or large synthetic file trees and have historically been slow. The two known offenders (`tests/skill/grasp/test_silent_exit_bugs.test.mjs > ENOTFOUND` and `tests/skill/grasp/test_scan_project.test.mjs > 501 files -> very-large`) hit vitest's default 30s ceiling intermittently under load. If they fail on a release cut, re-run just the affected files (`pnpm test -- tests/skill/grasp/test_silent_exit_bugs.test.mjs`) before blocking the release.

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
- **Strict PascalCase rejection (no silent normalisation)**: `push-concept-graph.mjs` does NOT normalise PascalCase labels back to kebab-case. If the LLM writes `"type": "BusinessRule"` into `pr-nodes.json`, the script aborts with a specific error pointing to the kebab-case form (`"type": "business-rule"`) and references SKILL.md §type-table. This is intentional — silent normalisation hid BUG-01 for several release cycles. The atomic-rejection behaviour is exercised by `test_push_concept_graph_skill_bugs.test.mjs` (BUG-01 post-fix regression). If you refactor the node-type pipeline, keep the upfront validation in `pushConceptGraph()` and the `suggestKebabCase()` helper — removing them risks reintroducing the silent-drop mode.

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

**Concept nodes silently dropped (`Unknown node type 'BusinessRule'` in stderr):**
The push script `push-concept-graph.mjs` rejects nodes whose `type` value is not in `TYPE_TO_LABEL` (the JSON `type` field must be kebab-case, e.g. `business-rule`, not the Neo4j PascalCase label `BusinessRule`). If you see this warning, the script has already aborted atomically — no nodes were written, the exit code is non-zero. Fix `pr-nodes.json`: replace `"type": "BusinessRule"` with `"type": "business-rule"` (and similarly for other PascalCase forms) and re-run. The error message itself names the canonical kebab-case form, so a search-and-replace is usually enough.
