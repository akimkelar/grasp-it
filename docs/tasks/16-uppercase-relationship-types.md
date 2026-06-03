# Lowercase relation types vs :UPPER_CASE Neo4j convention

## Status
open

## Description
The Neo4j convention is:
- **Node labels**: PascalCase (e.g., `File`, `Function`, `BusinessRule`)
- **Relationship types**: UPPER_SNAKE_CASE (e.g., `:CONTAINS`, `:IMPORTS`, `:CALLS`)

The current codebase uses lowercase for both in schema.ts `EdgeTypeSchema` enum. Currently no code writes directly to Neo4j (graphs are stored as JSON), but if a Neo4j writer is added later, the relationship types should be uppercase.

Also, the `merge-batch-graphs.py` script produces JSON graph data (not Cypher directly), so it would need a translation layer when Neo4j writing is implemented.

## What to do:
1. When Neo4j writing is implemented, ensure the translation layer uppercases relationship types (e.g., `contains` → `:CONTAINS`)
2. Document this convention clearly in docs/architecture/neo4j-schema.md relationship section
