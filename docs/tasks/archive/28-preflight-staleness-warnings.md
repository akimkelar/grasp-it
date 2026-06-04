# Task 28: Add Pre-Flight Staleness Warnings to Skills

## Objective

Add a staleness preflight check to `/grasp-diff`, `/grasp-domain`, and `/grasp-search` that warns the user if the graph is stale before the skill proceeds. This prevents users from querying or diffing against an outdated graph without realizing it.

## Background

See `docs/graph/outdating-rules.md` → "Gap 6".

Currently, `isStale()` in `grasp-it-plugin/packages/core/src/staleness.ts` exists and is correct. But none of the consumer skills call it. A user can run `/grasp-diff` on a graph last analyzed 20 commits ago without any warning.

The preflight check is non-blocking — it warns but does not stop execution (the user may intentionally query an old graph).

## Implementation Checklist

### 1. Create a reusable preflight check

- [ ] In `grasp-it-plugin/packages/core/src/staleness.ts` (or a new `preflight.ts`), add:
  ```typescript
  function checkGraphFreshness(projectDir: string): {
    stale: boolean;
    lastCommit: string;
    headCommit: string;
    commitsBehind: number; // output of `git rev-list <last>..HEAD --count`
  }
  ```

### 2. Add preflight to `/grasp-diff`

- [ ] Open `grasp-it-plugin/skills/grasp-diff/SKILL.md`
- [ ] Add Phase 0 step: run the freshness check
- [ ] If stale, print:
  > "⚠ Graph may be stale — last analyzed at `<lastCommit>` (`N` commits behind HEAD). Results may not reflect recent changes. Run `/grasp` to update."
- [ ] Continue execution regardless

### 3. Add preflight to `/grasp-domain`

- [ ] Open `grasp-it-plugin/skills/grasp-domain/SKILL.md`
- [ ] Add Phase 0 step: check `meta.json` (or Neo4j `Project` singleton) for `gitCommitHash`
- [ ] Also check `domainGraphStale` flag (from Task 26) — if set, add a more specific warning about the domain graph being out of sync

### 4. Add preflight to `/grasp-search`

- [ ] Open `grasp-it-plugin/skills/grasp-search/SKILL.md`
- [ ] Add Phase 0 step: same staleness check
- [ ] Print warning if stale

### 5. Tests

- [ ] Unit test: mock a stale `meta.json`, verify the warning message is generated correctly
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/packages/core/src/staleness.ts`
- `grasp-it-plugin/skills/grasp-diff/SKILL.md`
- `grasp-it-plugin/skills/grasp-domain/SKILL.md`
- `grasp-it-plugin/skills/grasp-search/SKILL.md`
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/28-report.md`
- [ ] Move this file to `docs/tasks/archive/28-preflight-staleness-warnings.md`
- [ ] Commit: `git add -A && git commit -m "feat: add pre-flight staleness warnings to grasp-diff, grasp-domain, grasp-search"`
- [ ] Push: `git push`
