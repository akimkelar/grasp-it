# Graph Staleness Rules

## Overview

The graph is **derived knowledge** — it is produced by analysis scripts and LLM agents from source code and concept plan sessions. When the sources change, the graph can become stale. Staleness must be controlled and visible.

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

### Per-node `sourceCommit` on knowledge nodes

Every knowledge node produced by code analysis carries a `sourceCommit` property — the git commit hash at which the node was derived. This enables direct staleness detection without traversing `IMPLEMENTED_BY` edges: a node whose `sourceCommit` is behind current HEAD is stale.

**Staleness detection via `sourceCommit`:**

```cypher
// Knowledge nodes whose sourceCommit is behind HEAD (stale by commit)
MATCH (k:Knowledge)
WHERE k.sourceCommit IS NOT NULL
  AND k.sourceCommit <> $currentCommit
RETURN labels(k)[0] AS type, k.id, k.name, k.sourceCommit, k.generatedAt
ORDER BY k.generatedAt
```

This query surfaces all knowledge nodes that were derived from an older commit. Combine with `generatedAt` to prioritize re-analysis: nodes with the oldest `generatedAt` that are also behind HEAD should be re-derived first.

**Comparison with `File.analyzedAtCommit` approach:**

| Approach | Checks | Answers |
|----------|--------|---------|
| `File.analyzedAtCommit` | A file has been re-analyzed since last graph build | "Has the implementation of this feature's code changed?" |
| `sourceCommit` on knowledge node | The knowledge node itself was derived at an older commit | "Is this piece of knowledge still valid at current HEAD?" |

Both signals are complementary. `sourceCommit` is the primary mechanism for per-node staleness; `File.analyzedAtCommit` is a secondary signal that confirms whether the underlying code has been re-analyzed.

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
| Knowledge node with `sourceCommit != currentCommit` | Node was derived from code at an older commit — re-derive to update |

### Implementation Status Staleness

`IMPLEMENTED_BY.status` values (`"legacy" | "target" | "shared" | "planned"`) track provenance:

| Status | Meaning |
|--------|---------|
| `target` | Current implementation |
| `legacy` | Old implementation, replaced by newer `target` |
| `shared` | Used by multiple features |
| `planned` | Designed but not yet implemented |

A `legacy` status on an `IMPLEMENTED_BY` edge means the knowledge node's understanding of the codebase is out of date — the actual code has moved on.

## Refresh Loop

Recommended refresh policy:

1. identify stale nodes (prioritize by `generatedAt` — oldest first)
2. resolve the affected subgraph around those nodes
3. re-run extraction only for the impacted area
4. replace or update stale nodes
5. set refreshed nodes back to `active`
6. update `generatedAt` to current timestamp and `sourceCommit` to HEAD
7. rebuild `sourceFiles`
8. recalculate migration parity where relevant

## Knowledge Node Provenance via `sourceFiles`

### Overview

Knowledge nodes carry a `sourceFiles: string[]` property that tracks which files were analyzed to derive the knowledge. This provides **provenance** — the ability to trace a knowledge node back to the specific files that informed its creation.

### Which nodes should have `sourceFiles`

The property is populated on these knowledge node types when `source: "code_analysis"`:

- `Domain`
- `Feature`
- `Operation`
- `BusinessRule`
- `Entity`
- `Risk`
- `Constraint`

Nodes with `source: "user_input"` or `source: "llm_generated"` typically do not have `sourceFiles` since they are derived from concept plans or LLM inference rather than direct code analysis.

### What it tracks

`sourceFiles` is an array of file paths (relative to the project root) that were used as context when the knowledge was extracted. For example:
- A `Feature` node representing "user authentication" might have `sourceFiles: ["src/auth/login.ts", "src/auth/session.ts"]`
- An `Operation` node for "calculateTotal" might have `sourceFiles: ["src/pricing/calculator.ts"]`

### When to populate

During domain analysis, the agent should record which files it read or analyzed when creating each knowledge node. This happens at the time of node creation — the `sourceFiles` array is set based on the file analysis context, not retroactively.

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

### Knowledge nodes behind current HEAD (via per-node `sourceCommit`)

```cypher
MATCH (k:Knowledge)
WHERE k.sourceCommit IS NOT NULL
  AND k.sourceCommit <> $currentCommit
RETURN labels(k)[0] AS type, k.id, k.name, k.sourceCommit, k.generatedAt
ORDER BY k.generatedAt
```

This finds knowledge nodes whose `sourceCommit` does not match the current HEAD, indicating the code they were derived from has changed. Older nodes (by `generatedAt`) should be re-derived first.

### Knowledge nodes derived from a deleted file (via `sourceFiles`)

```cypher
MATCH (k:Knowledge)
WHERE k.source = "code_analysis"
  AND k.sourceFiles IS NOT NULL
  AND ANY(filePath IN k.sourceFiles WHERE NOT fileExists(filePath))
RETURN labels(k)[0] AS type, k.id, k.name, k.sourceFiles
```

This query uses the `apoc.file.exists()` function (available in Neo4j APOC) to check whether each file in `sourceFiles` still exists on disk.

### Knowledge nodes with `IMPLEMENTED_BY` to a deleted file

```cypher
MATCH (k)-[:IMPLEMENTED_BY]->(f:File)
WHERE NOT fileExists(f.filePath)
RETURN labels(k)[0] AS type, k.id, k.name, f.filePath
```

### Graph vs. local commit sync check

```cypher
MATCH (p:Project {id: "project:singleton"})
RETURN p.gitCommitHash AS graphCommit, p.lastAnalyzedAt AS lastAnalyzedAt
```

Compare `graphCommit` against the local `git rev-parse HEAD` using `git merge-base` to determine ancestry (not just equality) — the graph may be ahead of the local clone, behind it, or at the same commit.

**Two separate checks serve different purposes:**

| Check | Compares | Answers |
|-------|----------|---------|
| **Phase 0 staleness check** (per-skill) | Neo4j `Project.gitCommitHash` vs. local git HEAD | "Do I need to re-run `/grasp`?" |
| **Cross-user sync check** | Local graph vs. shared Neo4j database | "Is my analysis in sync with the shared Neo4j database?" |

In single-user setups, both checks often agree. In multi-user setups, they can diverge: your local graph may be up-to-date with HEAD while Neo4j still holds an older commit hash (because another user pushed their analysis more recently).

## Resolving Staleness

| Condition | Resolution |
|-----------|------------|
| `implemented` feature has no `IMPLEMENTED_BY` edges | Re-run `/grasp-domain` to re-link to code |
| Feature has only `legacy` edges | Re-run `/grasp-domain` — code was refactored, new edges expected |
| `planned` feature became `implemented` but old entry remains | Re-run `/grasp-concept` to update status, or manually update |
| Actor/BusinessRule/Entity has no relationships | Review with PO — node may be incorrect or deprecated |
| Decision is `deprecated` | Archive or delete; review if any constraints depend on it |
| `IMPLEMENTED_BY` edge to file with stale `analyzedAtCommit` | Re-run `/grasp` to re-analyze the file; re-run `/grasp-domain` to refresh knowledge links |
| Knowledge node with stale `sourceCommit` | Re-run the originating skill (`/grasp-domain` for code-analysis nodes, `/grasp-concept` for concept nodes) to re-derive the node at current HEAD; update `generatedAt` and `sourceCommit` |
| Knowledge node has `sourceFiles` referencing deleted files | Review the node — if the underlying concept no longer exists, archive or delete the node; if files were renamed, update `sourceFiles` and re-run analysis |
| `IMPLEMENTED_BY` edge to deleted file | Re-run `/grasp-domain` to re-derive knowledge from remaining code; orphan check may reveal nodes that need manual cleanup |

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

When merging subdomain graphs, there is no check to verify all subdomain graphs were built at the same git commit. Subdomain graphs from different commits can be merged without warning.

### Gap 6 — No pre-flight staleness warning in skills
**Task:** 28

`/grasp-diff`, `/grasp-domain`, and `/grasp-search` do not check whether the graph is stale before running. A user can query a stale graph without any warning.

### Gap 7 — `sourceFiles` not kept in sync after file renames or moves

When a file is renamed or moved, knowledge nodes that reference it in `sourceFiles` become stale but are not automatically updated. Unlike `IMPLEMENTED_BY` edges (which are rebuilt during incremental `/grasp` runs), `sourceFiles` is not recalculated unless the node is explicitly re-derived.

**Two complementary signals must be used together for comprehensive deletion detection:**

1. **`sourceFiles` array** — provenance: "which files were analyzed to derive this knowledge"
2. **`IMPLEMENTED_BY` edges** — semantic: "which code implements this feature"

When a file is deleted:
- Knowledge nodes with that file in `sourceFiles` may represent knowledge that is now orphaned or needs re-derivation
- Knowledge nodes with `IMPLEMENTED_BY` edges to that file represent features that lost their implementation

Both approaches are needed because `sourceFiles` and `IMPLEMENTED_BY` can diverge:
- A `Feature` may have `sourceFiles: ["src/auth/old.ts"]` but `IMPLEMENTED_BY` to a different file that still exists (the feature was re-implemented elsewhere)
- A `Feature` may have `IMPLEMENTED_BY` to a deleted file but no `sourceFiles` (it was created from a concept plan, not code analysis)

The resolution workflow should check both: first identify nodes via `sourceFiles`, then via `IMPLEMENTED_BY` to deleted files, then merge the results and review each for archive or re-derivation.
