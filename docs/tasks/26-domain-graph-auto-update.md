# Task 26: Auto-Flag Domain Graph as Stale After Codebase Update

## Objective

After any incremental `/grasp` update, automatically detect that the domain graph (`domain-graph.json`) is stale and surface a visible warning. Optionally trigger an auto-re-run of `/grasp-domain` if `autoUpdate: true` is configured.

## Background

See `docs/graph/outdating-rules.md` → "Gap 3".

When `/grasp` performs an incremental update, the domain graph is silently out of sync: its `project.gitCommitHash` no longer matches the codebase graph. Users who rely on domain-driven task generation or the domain view in the dashboard may be working with stale domain knowledge.

## Implementation Checklist

### 1. Write `domainGraphStale` flag after incremental update

- [ ] Open `grasp-it-plugin/packages/core/src/types.ts` — locate `AnalysisMeta`
- [ ] Add optional field: `domainGraphStale?: boolean`
- [ ] In `/grasp` SKILL.md Phase 7 (SAVE), after writing `meta.json`:
  - Check whether `domain-graph.json` exists
  - Compare `domain-graph.json` → `project.gitCommitHash` against the new hash
  - If they differ, write `domainGraphStale: true` to `meta.json` (or `ProjectMeta`)

### 2. Surface the warning in `/grasp` output

- [ ] At the end of Phase 7, if `domainGraphStale: true`, print:
  > "Domain graph is out of sync with the updated codebase. Re-run `/grasp-domain` to refresh domain links."

### 3. Check the flag in `/grasp-domain`

- [ ] In `/grasp-domain` SKILL.md Phase 0 (preflight), read `meta.json`
- [ ] If `domainGraphStale: false` and `--full` is not passed, the domain graph is current → skip re-derivation with a message "Domain graph is up to date"
- [ ] Clear `domainGraphStale` after a successful `/grasp-domain` run

### 4. Optional: auto-trigger `/grasp-domain`

- [ ] If `config.json` has `autoUpdate: true`, auto-trigger `/grasp-domain` at the end of `/grasp` Phase 7 instead of just writing the flag
- [ ] This is optional and should be gated on the config flag

### 5. Tests

- [ ] Write a test for the flag write/clear cycle: run incremental update → flag set → run `/grasp-domain` → flag cleared
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/packages/core/src/types.ts`
- `grasp-it-plugin/packages/core/src/persistence/index.ts`
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `grasp-it-plugin/skills/grasp-domain/SKILL.md`
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/26-report.md`
- [ ] Move this file to `docs/tasks/archive/26-domain-graph-auto-update.md`
- [ ] Commit: `git add -A && git commit -m "feat: flag domain graph as stale after incremental codebase update"`
- [ ] Push: `git push`
