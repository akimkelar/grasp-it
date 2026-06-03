# Document missing node types in neo4j-schema.md

## Status
open

## Description
The investigation revealed 10 node types in `schema.ts` `GraphNodeSchema` that are not documented in `docs/architecture/neo4j-schema.md`:

- `concept` — Non-code structural node for abstract ideas
- `document` — Documentation files (README, docs/)
- `service` — Container/pod/deployment definitions
- `pipeline` — CI/CD pipeline definitions (job, ci, step)
- `schema` — Protobuf/OpenAPI/GraphQL schema definitions (distinct from `Table`)
- `resource` — Infrastructure-as-code (Terraform, etc.)
- `article` — Wiki/knowledge-base articles
- `topic` — Topic/category nodes
- `claim` — Assertion/thesis nodes
- `source` — Reference/source nodes

Also the casing convention needs clarifying: the documentation uses PascalCase node labels (`File`, `Function`, `BusinessRule`) matching the Cypher constraints, but the code schema enum uses lowercase (`"file"`, `"BusinessRule"`). The `sanitizeGraph` step lowercases all input before validation, and the `normalizeGraph` alias step handles the canonical forms. Document this clearly.

### What to do:
1. Read `docs/architecture/neo4j-schema.md`
2. Read `grasp-it-plugin/packages/core/src/schema.ts` to see all node types
3. Add a "Non-code Node Types" section documenting each of the 10 types above with description and example ID pattern
4. Clarify the casing convention (documentation = PascalCase, code = lowercase enum values)
