# Task 29: Add Staleness Check to Subdomain Graph Merge

## Objective

When `merge-subdomain-graphs.py` combines subdomain graphs into the main graph, warn if any subdomain graph was built at a different git commit than the others. The merged result should use the oldest (most conservative) commit hash, not the latest-by-timestamp.

## Background

See `docs/graph/outdating-rules.md` → "Gap 5".

`merge-subdomain-graphs.py` takes `latest_hash` as the `gitCommitHash` of whichever subdomain graph has the latest `analyzedAt` timestamp. This can silently produce a merged graph that claims to be at commit C while one of its subdomain inputs was actually built at commit A. For most small projects this path is never triggered, but for monorepos with multiple subdomain graphs it causes hidden inconsistencies.

## Implementation Checklist

### 1. Read the current merge script

- [ ] Read `grasp-it-plugin/skills/grasp/merge-subdomain-graphs.py` (or equivalent merge script)
- [ ] Identify where `gitCommitHash` is selected for the merged output

### 2. Add multi-hash detection

- [ ] Collect all distinct non-empty `gitCommitHash` values across all input graphs
- [ ] If more than one distinct hash exists, emit a warning to stderr:
  ```
  Warning: subdomain graphs were built at different commits:
    - subgraph-A: abc123 (2026-06-01)
    - subgraph-B: def456 (2026-06-03)
  The merged graph will use the oldest commit (abc123) as the canonical hash.
  Re-run /grasp on all subdomains at the same commit for a consistent merge.
  ```

### 3. Use oldest commit as merged hash

- [ ] Replace the current "latest-by-timestamp" selection with ancestry comparison using `git merge-base`
- [ ] The merged output's `gitCommitHash` = the commit that is an ancestor of all other hashes (or the first in topological order if no single ancestor exists)
- [ ] If no common ancestor can be determined, use the oldest by `analyzedAt` and include the warning

### 4. Tests

- [ ] Write a test with two mock subdomain graph objects having different `gitCommitHash` values — verify the warning is emitted and the merged hash is the older one
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/skills/grasp/merge-subdomain-graphs.py` (or equivalent)
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `docs/graph/outdating-rules.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/29-report.md`
- [ ] Move this file to `docs/tasks/archive/29-subdomain-merge-staleness-check.md`
- [ ] Commit: `git add -A && git commit -m "fix: warn and use oldest commit hash when merging subdomain graphs at different commits"`
- [ ] Push: `git push`
