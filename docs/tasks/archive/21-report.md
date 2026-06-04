# Task 21 Completion Report: Add `analyzedAtCommit` Property to File Nodes

## Summary

Added the `analyzedAtCommit` property to `File` nodes in the codebase subgraph, enabling per-file staleness detection for knowledge nodes.

## Changes Made

### 1. Type Definition (`grasp-it-plugin/packages/core/src/types.ts`)

Added `analyzedAtCommit?: string` to the `GraphNode` interface, documented as "File (git commit hash at which file was last analyzed)".

### 2. Core Extraction (`grasp-it-plugin/packages/core/src/analyzer/graph-builder.ts`)

Modified `addFile()` and `addFileWithAnalysis()` to set `analyzedAtCommit: this.gitHash` when creating file nodes. Both the full-rebuild and incremental-update code paths use the same `GraphBuilder` methods, so the property is set consistently in all cases.

### 3. Tests (`grasp-it-plugin/packages/core/src/analyzer/graph-builder.test.ts`)

Updated the existing "should create file nodes from file list" test to assert that file nodes carry `analyzedAtCommit: "abc123"` (matching the git hash passed to the builder constructor).

## Schema Documentation

The property was already documented in `docs/graph/architecture.md` (added during Task 21 prep). The `File` node section states: "File nodes carry an `analyzedAtCommit` property — the git commit hash at which this file was last re-analyzed." The schema section of `docs/architecture/neo4j-schema.md` captures the property in the staleness detection query pattern.

## Verification

- Build: `pnpm --filter @grasp-it/core build` - passed
- Tests: `pnpm --filter @grasp-it/core test` - **779 tests passed** across 36 test files (graph-builder test count increased from 17 to 18, reflecting the new assertion)
- Lint: ESLint 9 requires a config file migration not yet done on this project (pre-existing issue, not introduced by this change)
