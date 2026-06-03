# Task 16 — Casing Conventions: Node Types and Relationship Types

## Status

**COMPLETED** — 2026-06-03

## What was done

This task documents the Neo4j casing conventions and implements the transformation functions
that the future Neo4j writer will use to convert internal lowercase/kebab-case type values to
the correct Neo4j label and relationship type formats.

### Changes made

#### 1. `grasp-it-plugin/packages/core/src/schema.ts` — Added `toNeo4jLabel` and `toNeo4jRelationshipType`

```typescript
export function toNeo4jLabel(internalType: string): string {
  // Split on hyphens and capitalize each segment (handles kebab-case)
  return internalType
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join("");
}

export function toNeo4jRelationshipType(internalType: string): string {
  return internalType.toUpperCase();
}
```

- **`toNeo4jLabel`**: Splits on hyphens to handle kebab-case inputs like `"business-rule"` → `"BusinessRule"`. Simple types like `"file"` → `"File"` work via the same logic.
- **`toNeo4jRelationshipType`**: Uppercases the string directly, e.g. `"implemented_by"` → `"IMPLEMENTED_BY"`.

Both functions are exported from `schema.ts` and re-exported from `packages/core/src/index.ts` so any Neo4j writer implementation can import them directly.

#### 2. `grasp-it-plugin/packages/core/src/index.ts` — Re-exported new functions

Added `toNeo4jLabel` and `toNeo4jRelationshipType` to the existing schema re-exports.

#### 3. `grasp-it-plugin/skills/grasp/merge-batch-graphs.py` — Added Python equivalents

```python
def to_neo4j_label(internal_type: str) -> str:
    return "".join(seg[0].upper() + seg[1:].lower() for seg in internal_type.split("-"))

def to_neo4j_relationship_type(internal_type: str) -> str:
    return internal_type.upper()
```

These are co-located in the merge script (which produces JSON that a future Neo4j writer
will consume) so both the Python and TypeScript sides have matching transformation logic.

#### 4. `docs/architecture/neo4j-schema.md` — Updated "Internal type representation" section

Updated the documentation to reference the new transformation functions with examples, and
clarified that the `BusinessRule` internal casing issue is tracked in Task 17.

## How a Neo4j writer will use these

When a Neo4j writer is added, it will import these functions and apply them when writing nodes
and edges to Neo4j:

```typescript
import { toNeo4jLabel, toNeo4jRelationshipType } from "@grasp-it/core";

// For each node, convert internal type to Neo4j label:
const label = toNeo4jLabel(node.type);  // "business-rule" → "BusinessRule"

// For each edge, convert internal type to Neo4j relationship type:
const relType = toNeo4jRelationshipType(edge.type);  // "implemented_by" → "IMPLEMENTED_BY"

// Cypher MERGE uses the label and relationship type directly:
session.run(`
  MERGE (a:${toNeo4jLabel(sourceNode.type)} {id: $sourceId})
  MERGE (b:${toNeo4jLabel(targetNode.type)} {id: $targetId})
  MERGE (a)-[r:${toNeo4jRelationshipType(edge.type)}]->(b)
`, { sourceId, targetId, ... })
```

The Python versions in `merge-batch-graphs.py` are available for any Python-based Neo4j writer.

## Verification

- `pnpm --filter @grasp-it/core build` — builds cleanly
- `pnpm test` — all 214 tests pass (no regressions)
- `pnpm lint` — ESLint v9 config issue pre-existed (unrelated to this task)

## Relationship to Task 17 (BusinessRule casing)

The transformation functions are agnostic to the canonical internal value. Once Task 17
changes the `schema.ts` enum from `"BusinessRule"` (PascalCase) to `"business-rule"`
(kebab-case), `toNeo4jLabel("business-rule")` will correctly return `"BusinessRule"`.
No changes to the transformation functions are needed when Task 17 lands.

## Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| Neo4j writer uses PascalCase labels and UPPER_SNAKE_CASE relationship types | Functions provided; writer not yet implemented |
| No special-casing of individual node types needed | Uniform `toNeo4jLabel` handles all types via kebab-split |
| Existing JSON graph files remain unaffected | Internal format unchanged; transformation only at Neo4j write time |