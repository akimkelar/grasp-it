# Document missing node types in neo4j-schema.md

## Reference documents

- Primary: `docs/architecture/neo4j-schema.md` — the canonical schema reference being updated
- Schema code: `grasp-it-plugin/packages/core/src/schema.ts` — source of truth for node types in code
- Decisions context: `docs/architecture/schema-evolution-plan.md`

## Status
partially done — documentation updated, schema.ts casing fix tracked in Task 17

## Description

The "Additional Non-code Node Types" section has been added to `docs/architecture/neo4j-schema.md`
and the node types have been properly categorised. The following was completed as part of this
research task:

- Structural non-code nodes (`Document`, `Service`, `Pipeline`, `Schema`, `Resource`) documented
  as codebase subgraph members with correct ID patterns
- Knowledge provenance nodes (`Article`, `Topic`, `Claim`, `Source`) documented as future
  `/grasp-knowledge` only nodes with a clear "do not create in codebase agents" note
- `Concept` documented as a deferred/optional catch-all
- `schema-evolution-plan.md` deferred list corrected (structural nodes removed from it)
- "What to Keep Unchanged" section in `schema-evolution-plan.md` corrected (Flow/Step dropped,
  Claim reclassified)
- Token Cost Summary table updated (Flow/Step removed, structural and wiki nodes added)
- Casing convention documented in the Labeling Convention section of `neo4j-schema.md`
- Node ID Conventions table expanded to include all 20 node types with internal `type` values

## Remaining work

The internal representation inconsistency (`"BusinessRule"` PascalCase in schema.ts enum vs
lowercase for all other types) is tracked separately in **Task 17**.

## What not to do
Do not reopen questions about whether structural nodes belong in the schema — that is settled.
Do not reopen the deferred list — see `schema-evolution-plan.md` Final Decisions.
