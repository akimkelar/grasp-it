# Graph Staleness Rules

## Overview

The graph is **derived knowledge** — it is produced by analysis scripts and LLM agents from source code and PO interviews. When the sources change, the graph can become stale. Staleness must be controlled and visible.

## Types of Staleness

### Codebase Staleness

The codebase subgraph (`kind: "codebase"`) is rebuilt on every `/grasp` run. It is not stale — it is regenerated. However:

- A **codebase node whose target file no longer exists on disk** is an artifact of an incomplete rebuild and should not persist
- **Import edges to deleted files** should be cleaned up during rebuild

The rebuild pattern handles this automatically:
```cypher
MATCH (n) WHERE n.kind = "codebase" DETACH DELETE n
```

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