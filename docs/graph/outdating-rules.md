# Graph Staleness Rules

## Overview

The graph is **derived knowledge** — it is produced by analysis scripts and LLM agents from source code and PO interviews. When the sources change, the graph can become stale. Staleness must be controlled and visible.

## How "New" Code Is Determined

**Git commit hash comparison is the sole mechanism**, not file modification dates.

When `/grasp` runs, Phase 0 reads the previously stored `gitCommitHash`, then compares:

```bash
git diff <lastCommitHash>..HEAD --name-only
```

This returns the list of changed files. If no files changed, the graph is considered up to date.

### Canonical source of `gitCommitHash`

The hash is stored in two places (in order of authority):

| Location | When used |
|----------|-----------|
| **Neo4j `Project` singleton** (`Project.gitCommitHash`) | Multi-user cloud setup — all users read the shared canonical hash from Neo4j |
| **`.grasp-it/knowledge-graph.json`** (`project.gitCommitHash`) | Single-user local fallback — already present in every `/grasp` output, read before any Neo4j query |

`.grasp-it/meta.json` is a redundant local copy of the same hash written for backward compatibility. The skill reads `knowledge-graph.json` first (Phase 0 step 5) — `meta.json` is not structurally required and is slated for removal once the `Project` singleton is in place (see Task 22).

File modification timestamps are **not** used anywhere in staleness detection.

## Design Decisions

### `analyzedAtCommit` on `File` nodes

Every `File` node (codebase subgraph) carries an `analyzedAtCommit` property — the git commit hash at which that file was last re-analyzed. This is set (or updated) whenever a file is processed during an incremental or full analysis run.

Purpose: enables per-file staleness detection for knowledge nodes. A `Feature` or `Operation` with an `IMPLEMENTED_BY` edge to a `File` where `File.analyzedAtCommit != currentCommit` is a candidate for review — the code it references has been updated since the knowledge was extracted.

See Task 21 for implementation.

### `Project` singleton node

A single `(p:Project {id: "project:singleton", kind: "project"})` node holds project-level metadata. It is excluded from the codebase wipe (`WHERE n.kind = "codebase"`) and therefore persists across all `/grasp` runs. In multi-user scenarios, this is the shared authoritative source of the last-analyzed commit hash.

See Task 22 for implementation.

## Types of Staleness

### Codebase Staleness

The codebase subgraph (`kind: "codebase"`) is rebuilt on every `/grasp` run. It is not permanently stale — it is regenerated. However:

- A **codebase node whose target file no longer exists on disk** is an artifact of an incomplete rebuild and should not persist
- **Import edges to deleted files** should be cleaned up during rebuild

The rebuild pattern handles this automatically:
```cypher
MATCH (n) WHERE n.kind = "codebase" DETACH DELETE n
```

**Incremental update behavior:** When `/grasp` detects changed files, it:
1. Removes nodes whose `filePath` matches any changed file
2. Removes edges whose `source` or `target` references a removed node
3. Re-analyzes the changed files and merges the results
4. Sets `analyzedAtCommit` on each re-analyzed `File` node

### Knowledge Staleness

Knowledge nodes (`kind: "knowledge"`) persist across `/grasp` runs and can become stale:

| Signal | Meaning |
|--------|---------|
| `status: "implemented"` but no `IMPLEMENTED_BY` edges to existing code | Feature/operation was implemented but code was deleted |
| `status: "implemented"` but all `IMPLEMENTED_BY` edges have `status: "legacy"` | Feature was re-implemented elsewhere; old edges are stale |
| `Feature` with no operations and no `IMPLEMENTED_BY` edges | Possibly abandoned feature |
| `Actor` with no `PERFORMED_BY` or `RESTRICTED_FOR` relationships | Actor defined but never referenced |
| `BusinessRule` with no `GOVERNS` relationships | Rule defined but not applied to any feature/operation |
| `Decision` with `status: "deprecated"` | Decision is obsolete — should be reviewed |
| `IMPLEMENTED_BY` edge where `File.analyzedAtCommit != currentCommit` | Knowledge derived from a file that has since changed — review required |

### Implementation Status Staleness

`IMPLEMENTED_BY.status` values (`"legacy" | "target" | "shared" | "planned"`) track provenance:

| Status | Meaning |
|--------|---------|
| `target` | Current implementation |
| `legacy` | Old implementation, replaced by newer `target` |
| `shared` | Used by multiple features |
| `planned` | Designed but not yet implemented |

A `legacy` status on an `IMPLEMENTED_BY` edge means the knowledge node's understanding of the codebase is out of date — the actual code has moved on.

## Detecting Staleness

### Orphaned knowledge nodes

```cypher
MATCH (n)
WHERE n.kind = "knowledge"
  AND NOT EXISTS((n)-[:HAS_FEATURE]->())  // no Domain
  AND NOT EXISTS((n)-[:HAS_OPERATION]->())  // no Feature (for Operation)
  AND NOT EXISTS(()-[:PERFORMED_BY]->(n))    // no Actor references (for Actor)
  AND NOT EXISTS((n)-[:GOVERNS]->())         // no targets (for BusinessRule)
RETURN labels(n)[0] AS type, n.id, n.name
```

### Implemented features with no code links

```cypher
MATCH (f:Feature {status: "implemented"})
WHERE NOT EXISTS((f)-[:IMPLEMENTED_BY]->())
RETURN f.id, f.name, f.summary
```

### Legacy-only features (no target implementation)

```cypher
MATCH (f:Feature)
WHERE EXISTS((f)-[:IMPLEMENTED_BY {status: "legacy"}]->())
  AND NOT EXISTS((f)-[:IMPLEMENTED_BY {status: "target"}]->())
RETURN f.id, f.name
```

### Knowledge nodes whose source file was updated since extraction

```cypher
MATCH (k)-[:IMPLEMENTED_BY]->(f:File)
WHERE f.analyzedAtCommit IS NOT NULL
  AND f.analyzedAtCommit <> $currentCommit
RETURN labels(k)[0] AS type, k.id, k.name, f.filePath, f.analyzedAtCommit
ORDER BY f.analyzedAtCommit
```

### Graph vs. local commit sync check

```cypher
MATCH (p:Project {id: "project:singleton"})
RETURN p.gitCommitHash AS graphCommit, p.lastAnalyzedAt AS lastAnalyzedAt
```

Compare `graphCommit` against the local `git rev-parse HEAD` using `git merge-base` to determine ancestry (not just equality) — the graph may be ahead of the local clone, behind it, or at the same commit.

## Resolving Staleness

| Condition | Resolution |
|-----------|------------|
| `implemented` feature has no `IMPLEMENTED_BY` edges | Re-run `/grasp-domain` to re-link to code |
| Feature has only `legacy` edges | Re-run `/grasp-domain` — code was refactored, new edges expected |
| `planned` feature became `implemented` but old entry remains | Re-run `/grasp-requirements` to update status, or manually update |
| Actor/BusinessRule/Entity has no relationships | Review with PO — node may be incorrect or deprecated |
| Decision is `deprecated` | Archive or delete; review if any constraints depend on it |
| `IMPLEMENTED_BY` edge to file with stale `analyzedAtCommit` | Re-run `/grasp` to re-analyze the file; re-run `/grasp-domain` to refresh knowledge links |

## Visibility

Staleness signals are queryable — the graph does not silently go stale. Users can run the detection queries above to assess graph freshness before relying on it for task generation or implementation planning.

The `graph-reviewer` agent also validates staleness as part of its approval process: a graph with many orphaned nodes or stale `IMPLEMENTED_BY` edges should be rejected and rebuilt.

## Scripts That Check for Outdated Data

### Primary: `/grasp` skill (grasp-it-plugin/skills/grasp/)

The main analysis skill. Phase 0 decision logic:
1. Reads `knowledge-graph.json` (or Neo4j `Project` singleton) to get `gitCommitHash`
2. Runs `git diff <lastCommitHash>..HEAD --name-only`
3. If no files changed → "Graph is up to date" (STOP)
4. If files changed → incremental update

### Fingerprint-based change detection (grasp-it-plugin/packages/core/src/fingerprint.ts)

Used during auto-update to classify changes at a finer granularity:

- `NONE` — content hash identical
- `COSMETIC` — content changed but structural signatures match
- `STRUCTURAL` — function/class signatures changed

The `classifyUpdate()` function in `change-classifier.ts` returns `SKIP` for cosmetic-only changes. This is wired for auto-update but not yet used in the main `/grasp` incremental path (see Gap 1 below / Task 23).

### `/grasp-diff` skill (grasp-it-plugin/skills/grasp-diff/)

Reads the existing graph and compares against git diff. Does not write to the graph or check staleness — it only analyzes what changed and identifies affected components.

### `/grasp-domain` skill (grasp-it-plugin/skills/grasp-domain/)

Derives domain knowledge from an existing graph. If a graph exists and `--full` is not passed, it skips file scanning entirely. If the underlying codebase has changed, the domain graph will be stale until `/grasp` re-runs.

### `/grasp-knowledge` skill (grasp-it-plugin/skills/grasp-knowledge/)

Handles Karpathy-pattern LLM wikis. Produces a separate `knowledge-graph.json` with `kind: "knowledge"`. Has its own staleness logic based on file modification detection within the wiki directory.

## Update Scope

| Layer | Update Mechanism | Staleness Handling |
|-------|-----------------|-------------------|
| **Codebase** (`kind: "codebase"`) | Full rebuild or incremental update via `/grasp` | Graph regenerated; nodes for changed files removed and re-created; `analyzedAtCommit` updated per file |
| **Domain** (`kind: "domain"`, in `domain-graph.json`) | Derived from main `knowledge-graph.json` or built from lightweight scan | Re-derived when `/grasp-domain` runs; auto-staleness flag written to `ProjectMeta` after any incremental update (see Task 26) |
| **Knowledge** (`kind: "knowledge"`) | Separate `/grasp-knowledge` run for wiki directories | Manual staleness detection via queries above; `IMPLEMENTED_BY` edges to changed files flagged via `analyzedAtCommit` (see Task 25) |

## Gaps in Update Logic

The gaps below are known deficiencies. Each has an associated task for resolution.

### Gap 1 — No structural vs. cosmetic change differentiation in main incremental update
**Task:** 23

The main `/grasp` incremental path uses `git diff --name-only` to detect ALL changed files, treating cosmetic changes the same as structural ones. The fingerprint system (`fingerprint.ts`, `classifyUpdate()`) already distinguishes `NONE / COSMETIC / STRUCTURAL` but is not wired into the main path.

### Gap 2 — No cross-file graph edge cleanup for incremental updates
**Task:** 24

When a file is changed, only nodes with matching `filePath` are removed. If imports change or functions are renamed, inbound edges from unchanged files to the old node IDs persist as dangling edges.

### Gap 3 — Domain graph not automatically updated
**Task:** 26

`domain-graph.json` must be explicitly re-derived with `/grasp-domain` after codebase changes. After an incremental `/grasp` update, the domain graph silently references stale code nodes.

### Gap 4 — No stale detection for knowledge nodes when implemented code changes
**Task:** 25

When `/grasp` performs an incremental update and removes/re-creates nodes for changed files, knowledge nodes with `IMPLEMENTED_BY` edges to those files are not automatically flagged or updated. The `analyzedAtCommit` property (Task 21) enables detection; this task wires it in.

### Gap 5 — Subdomain graph merge has no staleness check
**Task:** 29

`merge-subdomain-graphs.py` does not check whether all subdomain graphs were built at the same git commit. Subdomain graphs from different commits can be merged without warning.

### Gap 6 — No pre-flight staleness warning in skills
**Task:** 28

`/grasp-diff`, `/grasp-domain`, and `/grasp-search` do not check whether the graph is stale before running. A user can query a stale graph without any warning.
