# Task 21: Add `analyzedAtCommit` Property to File Nodes

## Objective

Add an `analyzedAtCommit` property to every `File` node in the codebase subgraph. The property holds the git commit hash at which that file was last analyzed. This is the foundational change that enables per-file staleness detection for knowledge nodes (Tasks 24 and 25 depend on it).

## Background

See `docs/graph/outdating-rules.md` → "Design Decisions: `analyzedAtCommit` on File nodes" and `docs/graph/architecture.md` → "Codebase Nodes".

Currently, `File` nodes have no record of when they were last analyzed. The graph-level `gitCommitHash` (on `knowledge-graph.json` and the `Project` singleton) tells us the commit at which the whole analysis ran, but not which files were re-analyzed in an incremental update. Without per-file commit tracking, knowledge staleness detection via `IMPLEMENTED_BY` edges requires scanning all files rather than targeting only changed ones.

## Implementation Checklist

### 1. Type definition

- [ ] Open `grasp-it-plugin/packages/core/src/types.ts`
- [ ] Locate `GraphNode` (or the `FileNode` variant if discriminated by type)
- [ ] Add optional property: `analyzedAtCommit?: string`

### 2. Core extraction

- [ ] Open `grasp-it-plugin/packages/core/src/` (extraction modules, likely `extract-structure.mjs` or equivalent)
- [ ] When building a `File` node, set `analyzedAtCommit` to the current git HEAD hash passed in as context
- [ ] Ensure this is set for both full-rebuild and incremental-update paths

### 3. Persistence layer

- [ ] Open `grasp-it-plugin/packages/core/src/persistence/index.ts`
- [ ] In the Neo4j write path for `File` nodes, include `analyzedAtCommit` in the `SET` clause
- [ ] In the merge/incremental write path, update `analyzedAtCommit` on re-analyzed files

### 4. Schema documentation

- [ ] Confirm `docs/architecture/neo4j-schema.md` reflects the new property (the note was added in Task 21 prep — verify it is accurate after implementation)

### 5. Tests

- [ ] Add a test in `grasp-it-plugin/packages/core/` that verifies a `File` node built at a known commit hash has `analyzedAtCommit` set correctly
- [ ] Run `pnpm --filter @grasp-it/core test`

## Key Files

- `grasp-it-plugin/packages/core/src/types.ts`
- `grasp-it-plugin/packages/core/src/persistence/index.ts`
- `docs/graph/architecture.md`
- `docs/graph/outdating-rules.md`
- `docs/architecture/neo4j-schema.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/21-report.md`
- [ ] Move this file to `docs/tasks/archive/21-analyzedAtCommit-on-file-nodes.md`
- [ ] Commit: `git add -A && git commit -m "feat: add analyzedAtCommit property to File nodes"`
- [ ] Push: `git push`
