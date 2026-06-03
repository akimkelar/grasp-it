# Casing conventions: node types and relationship types

## Reference documents

- Convention documented here: `docs/architecture/neo4j-schema.md`
  (sections: "Labeling Convention", "Relationship Types", "Node ID Conventions")
- Internal representation details: `grasp-it-plugin/packages/core/src/schema.ts`
  (`sanitizeGraph`, `normalizeGraph`, `GraphNodeSchema`, `EdgeTypeSchema`)
- Prerequisite casing fix: Task 17 (`docs/tasks/17-fix-businessrule-casing.md`)

## Status
open

## Description

Two casing conventions must be respected throughout the codebase:

- **Neo4j node labels**: PascalCase (`File`, `BusinessRule`, `Document`)
- **Neo4j relationship types**: UPPER_SNAKE_CASE (`:CONTAINS`, `:IMPLEMENTED_BY`)
- **Internal `type` values** in JSON graph files and `schema.ts` enum: lowercase / kebab-case
  (`"file"`, `"business-rule"`, `"document"`)

The convention has been documented in `docs/architecture/neo4j-schema.md` (Labeling Convention
section and Node ID Conventions table).

## What still needs implementing

### When a Neo4j writer is added

The persistence layer that writes JSON graphs to Neo4j must:
1. Convert internal `type` values to PascalCase node labels
   - Simple: `"file"` → `File`, `"domain"` → `Domain`
   - Compound: `"business-rule"` → `BusinessRule`, `"pipeline"` → `Pipeline`
2. Convert internal edge `type` values to UPPER_SNAKE_CASE relationship types
   - `"contains"` → `:CONTAINS`, `"implemented_by"` → `:IMPLEMENTED_BY`
3. The `merge-batch-graphs.py` script produces JSON — it will also need this translation when
   Neo4j writing is added.

### Prerequisite: Task 17

The `BusinessRule` internal casing inconsistency in `schema.ts` must be fixed before a Neo4j
writer is implemented, or the writer will need to special-case `"BusinessRule"` separately.
Task 17 tracks this.

## Acceptance criteria

- Neo4j writer (when implemented) uses PascalCase labels and UPPER_SNAKE_CASE relationship types
- No special-casing of individual node types needed (uniform transformation rule applies)
- Existing JSON graph files remain unaffected (internal format stays lowercase/kebab-case)
