# Graph Quality Rules

## Overview

The graph must be safer and more useful than a search index. It should help prevent wrong assumptions, not create new ones. Quality rules define what makes a graph trustworthy.

## Quality Dimensions

| Dimension | Description |
|-----------|-------------|
| **Correctness** | Nodes and relationships reflect reality — no phantom edges, no wrong IDs |
| **Completeness** | Critical knowledge is captured — no feature completely disconnected from code |
| **Freshness** | Graph reflects current codebase state — no stale `implemented` status on deleted code |
| **Consistency** | Same concepts are named and structured the same way throughout |

## Node Quality Rules

### Feature rules

- Every `Feature` must have at least one `HAS_OPERATION` relationship OR an explicit `summary` explaining why it has no operations
- `Feature.status` must be `"planned"`, `"implemented"`, or `"partial"` — never null or empty
- `Feature.id` must follow `feature:<kebab-name>` format

### Operation rules

- Every `Operation` must have a non-empty `summary`
- `Operation.status` must be `"planned"`, `"implemented"`, or `"partial"`
- `Operation.id` must follow `operation:<kebab-name>` format
- An `Operation` should have at least one `PERFORMED_BY` or `RESTRICTED_FOR` relationship, unless it is clearly autonomous/system-level

### Actor rules

- `Actor.permissions` and `Actor.restrictions` should not both be empty
- `Actor.id` must follow `actor:<kebab-name>` format

### BusinessRule rules

- `BusinessRule.ruleText` must be non-empty — no rules with only a summary
- `BusinessRule.status` must be `"active"`, `"deprecated"`, or `"proposed"`

### Entity rules

- `Entity` nodes should be referenced by at least one `USES_ENTITY` relationship (an orphan entity is likely noise)

## Relationship Quality Rules

### SEQUENCE cycles

```cypher
MATCH path = (o1:Operation)-[:SEQUENCE*]->(o2:Operation)
WHERE o1 = o2
RETURN o1.id AS cycle_start
```

A cycle in `SEQUENCE` relationships is a structural error — operations cannot precede themselves.

### IMPLEMENTED_BY validity

```cypher
MATCH (k)-[r:IMPLEMENTED_BY]->(c)
WHERE k.kind = "knowledge"
  AND NOT EXISTS(c.id)
RETURN k.id AS knowledge_node, r
```

All `IMPLEMENTED_BY` targets must exist as nodes. If a target file was deleted, the relationship must be removed.

### GOVERNS weight

```cypher
MATCH (br:BusinessRule)-[r:GOVERNS]->(target)
WHERE r.weight IS NULL OR r.weight <= 0
RETURN br.id, br.name, target.id
```

Every `GOVERNS` relationship should have a positive `weight`.

### Confidence threshold

```cypher
MATCH (k)-[r:IMPLEMENTED_BY]->(c)
WHERE r.confidence < 0.5
RETURN k.id, k.name, r.confidence
```

`IMPLEMENTED_BY` edges with `confidence < 0.5` should be flagged for human review.

## Validation Queries

Run these to assess graph quality before publishing or using the graph:

```cypher
-- Orphaned knowledge nodes
MATCH (n)
WHERE n.kind = "knowledge"
  AND size([(n)--() | 1]) = 0
RETURN n.id, n.name

-- Operations without performers
MATCH (o:Operation)
WHERE NOT EXISTS((o)-[:PERFORMED_BY]->())
  AND NOT EXISTS((o)-[:RESTRICTED_FOR]->())
RETURN o.id, o.name

-- Features implemented but with no code links
MATCH (f:Feature {status: "implemented"})
WHERE NOT EXISTS((f)-[:IMPLEMENTED_BY]->())
RETURN f.id, f.name

-- Sequence cycles
MATCH path = (o1:Operation)-[:SEQUENCE*]->(o2:Operation)
WHERE o1 = o2
RETURN o1.id
```

## Graph Reviewer Validation

The `graph-reviewer` agent validates these rules before approving a graph. A graph that fails validation is rejected and must be rebuilt.

Review criteria:
1. No orphaned knowledge nodes (nodes with zero relationships)
2. No `SEQUENCE` cycles
3. No `IMPLEMENTED_BY` edges with `confidence < 0.5`
4. All `Feature` and `Operation` nodes have non-empty `summary`
5. All `Actor` nodes have at least one `permission` or `restriction`
6. All `BusinessRule` nodes have non-empty `ruleText`

## What Makes a Graph Unsafe

- A feature marked `"implemented"` that has no code links, leading to incorrect planning assumptions
- An `IMPLEMENTED_BY` edge with low confidence, causing the agent to trust wrong code locations
- Orphaned nodes that suggest the graph is incomplete
- `SEQUENCE` cycles that indicate logical contradictions in operation ordering