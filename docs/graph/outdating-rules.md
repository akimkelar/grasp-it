# Graph Staleness Rules

## Overview

The graph is **derived knowledge** — it is produced by analysis scripts and LLM agents from source code and PO interviews. When the sources change, the graph can become stale. Staleness must be controlled and visible.

## How "New" Code Is Determined

**Git commit hash comparison is the sole mechanism**, not file modification dates.

When `/grasp` runs, Phase 0 reads `meta.json` to get the previously stored `gitCommitHash`, then compares:

```bash
git diff <lastCommitHash>..HEAD --name-only
```

This returns the list of changed files. If no files changed, the graph is considered up to date.

The git commit hash is stored in:
- `.grasp-it/meta.json` — `AnalysisMeta.gitCommitHash`
- `.grasp-it/fingerprints.json` — `FingerprintStore.gitCommitHash`
- `.grasp-it/knowledge-graph.json` — `project.gitCommitHash`

File modification timestamps are **not** used anywhere in staleness detection.

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

## Resolving Staleness

| Condition | Resolution |
|-----------|------------|
| `implemented` feature has no `IMPLEMENTED_BY` edges | Re-run `/grasp-domain` to re-link to code |
| Feature has only `legacy` edges | Re-run `/grasp-domain` — code was refactored, new edges expected |
| `planned` feature became `implemented` but old entry remains | Re-run `/grasp-requirements` to update status, or manually update |
| Actor/BusinessRule/Entity has no relationships | Review with PO — node may be incorrect or deprecated |
| Decision is `deprecated` | Archive or delete; review if any constraints depend on it |

## Visibility

Staleness signals are queryable — the graph does not silently go stale. Users can run the detection queries above to assess graph freshness before relying on it for task generation or implementation planning.

The `graph-reviewer` agent also validates staleness as part of its approval process: a graph with many orphaned nodes or stale `IMPLEMENTED_BY` edges should be rejected and rebuilt.

## Scripts That Check for Outdated Data

### Primary: `/grasp` skill (grasp-it-plugin/skills/grasp/)

The main analysis skill. Phase 0 decision logic:
1. Reads `meta.json` to get `gitCommitHash`
2. Runs `git diff <lastCommitHash>..HEAD --name-only`
3. If no files changed → "Graph is up to date" (STOP)
4. If files changed → incremental update

### Fingerprint-based change detection (grasp-it-plugin/packages/core/src/fingerprint.ts)

Used during auto-update to classify changes at a finer granularity:

- `NONE` — content hash identical
- `COSMETIC` — content changed but structural signatures match
- `STRUCTURAL` — function/class signatures changed

This is used to decide whether a file change requires full re-analysis or can be skipped. See `build-fingerprints.mjs` and `analyzeChanges()`.

### `/grasp-diff` skill (grasp-it-plugin/skills/grasp-diff/)

Reads the existing graph and compares against git diff. Does not write to the graph or check staleness — it only analyzes what changed and identifies affected components.

### `/grasp-domain` skill (grasp-it-plugin/skills/grasp-domain/)

Derives domain knowledge from an existing graph. If a graph exists and `--full` is not passed, it skips file scanning entirely. If the underlying codebase has changed, the domain graph will be stale until `/grasp` re-runs.

### `/grasp-knowledge` skill (grasp-it-plugin/skills/grasp-knowledge/)

Handles Karpathy-pattern LLM wikis. Produces a separate `knowledge-graph.json` with `kind: "knowledge"`. Has its own staleness logic based on file modification detection within the wiki directory.

## Update Scope

| Layer | Update Mechanism | Staleness Handling |
|-------|-----------------|-------------------|
| **Codebase** (`kind: "codebase"`) | Full rebuild or incremental update via `/grasp` | Graph regenerated; nodes for changed files removed and re-created |
| **Domain** (`kind: "domain"`, in `domain-graph.json`) | Derived from main `knowledge-graph.json` or built from lightweight scan | Re-derived when `/grasp-domain` runs; can be stale if codebase changed but domain didn't re-run |
| **Knowledge** (`kind: "knowledge"`) | Separate `/grasp-knowledge` run for wiki directories | Manual staleness detection via queries above |

## Gaps in Update Logic

### 1. No structural vs. cosmetic change differentiation in main incremental update

The main `/grasp` incremental path uses `git diff --name-only` to detect ALL changed files, treating cosmetic changes the same as structural ones. A file whose content changed but whose function/class signatures did not change still triggers full re-analysis of that file.

The fingerprint system (`fingerprint.ts`, `analyzeChanges()`) can distinguish `NONE` / `COSMETIC` / `STRUCTURAL` but this is only wired for auto-update fingerprint comparison, not for the main incremental path in `/grasp`.

### 2. No cross-file graph edge cleanup for incremental updates

When a file is changed, only nodes with matching `filePath` are removed, and edges whose source/target references those nodes are removed. But if the change causes other files to have different import relationships, or if functions/classes were renamed or removed within changed files, edges that pointed to those old definitions may become dangling and remain in the graph.

### 3. Domain graph not automatically updated

The domain graph (`domain-graph.json`) is derived from the main `knowledge-graph.json` via `/grasp-domain`. If the codebase changes and `/grasp` re-runs, the domain graph is not automatically regenerated — it must be explicitly re-derived with `/grasp-domain`.

### 4. No stale detection for knowledge nodes when implemented code changes

When `/grasp` performs an incremental update and removes nodes for changed files, it only removes nodes whose `filePath` matches the changed file. Knowledge nodes (domain, feature, operation) that have `IMPLEMENTED_BY` edges to those files are NOT automatically updated or removed, even though the code they reference has changed.

For example: if `src/auth.ts` changes, file nodes for `src/auth.ts` are removed and re-created. But a `Feature` node with `IMPLEMENTED_BY` → `file:src/auth.ts` remains untouched — it will have a stale reference to the re-created file node.

### 5. Subdomain graphs no staleness check on merge

When `merge-subdomain-graphs.py` combines subdomain graphs into the main graph, it does not check whether the subdomain graphs were built at a different git commit than the main graph. If the main graph is at commit A and a subdomain graph was built at commit B (before A), the merged graph may have inconsistent staleness across subdomains.

### 6. Graph-reviewer staleness check is manual

The `graph-reviewer` agent validates staleness as part of approval, but there is no automated pre-flight check that runs the staleness queries before presenting a graph to users. A user could query the graph without knowing it is stale.
