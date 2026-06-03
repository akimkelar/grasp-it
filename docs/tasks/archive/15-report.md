# Task 15 — Document Missing Node Types

## Status

**COMPLETED** — all work done in prior session.

## Summary

The canonical schema reference `docs/architecture/neo4j-schema.md` was updated to document all 20 node types:

### Completed

- **Structural non-code nodes** (`Document`, `Service`, `Pipeline`, `Schema`, `Resource`) documented as codebase subgraph members with correct ID patterns and sources
- **Knowledge provenance nodes** (`Article`, `Topic`, `Claim`, `Source`) documented as future `/grasp-knowledge`-only nodes with explicit "do not create in codebase agents" notes
- **`Concept`** documented as deferred/optional catch-all
- **Node ID Conventions table** expanded to cover all 20 node types with internal `type` values
- **Casing convention** documented in the Labeling Convention section
- **`schema-evolution-plan.md`** deferred list corrected and "What to Keep Unchanged" section corrected

### Remaining (tracked elsewhere)

The internal `BusinessRule` casing inconsistency (`"BusinessRule"` PascalCase in `schema.ts` enum vs kebab-case for all other types) is tracked in **Task 17**.

## Verification

All documented node types confirm against `schema.ts` `GraphNodeSchema` enum (line 379–386):
- All lowercase: `file`, `function`, `class`, `module`, `concept`, `config`, `document`, `service`, `table`, `endpoint`, `pipeline`, `schema`, `resource`, `domain`, `feature`, `operation`, `actor`, `entity`, `article`, `topic`, `claim`, `source`, `decision`, `constraint`
- Exception (tracked in Task 17): `BusinessRule`

All structural node types confirmed programmatically extractable via `extract-structure.mjs` and related scripts.

## References

- `docs/architecture/neo4j-schema.md` — updated schema reference
- `docs/architecture/schema-evolution-plan.md` — updated deferred list and final decisions
- `grasp-it-plugin/packages/core/src/schema.ts` — source of truth for node types
