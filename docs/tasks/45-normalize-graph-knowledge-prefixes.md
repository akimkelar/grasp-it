# Task 45: Add missing knowledge node prefixes to `normalize-graph.ts`

## Background

The `normalize-graph.ts` file maintains `VALID_PREFIXES` and `TYPE_TO_PREFIX` mappings used to
normalize graph node IDs. Investigation of the file found that many knowledge node types — including
`claim`, `decision`, `constraint`, `risk`, `actor`, `entity`, `feature`, `operation`, `domain`,
`business-rule` — are absent or incomplete in these mappings.

This means that knowledge nodes produced by `/grasp-requirements` or `/grasp-domain` may fail
ID normalization, potentially causing dangling edges to be dropped when the graph is processed.

## File to change

`grasp-it-plugin/packages/core/src/analyzer/normalize-graph.ts`

## Required changes

Read the file first to understand the exact current structure of `VALID_PREFIXES` and
`TYPE_TO_PREFIX`. Then ensure the following prefixes are present and consistent:

**Node types and their ID prefixes** (from `docs/architecture/neo4j-schema.md`, Node ID Conventions section):

| Internal type | ID prefix |
|---------------|-----------|
| `"domain"` | `domain:` |
| `"feature"` | `feature:` |
| `"operation"` | `operation:` |
| `"actor"` | `actor:` |
| `"business-rule"` | `business-rule:` |
| `"entity"` | `entity:` |
| `"decision"` | `decision:` |
| `"constraint"` | `constraint:` |
| `"concept"` | `concept:` |
| `"claim"` | `claim:` |
| `"risk"` | `risk:` |

All of these belong to the knowledge subgraph (`kind: "knowledge"`).

Existing codebase node prefixes (`file:`, `function:`, `class:`, etc.) must remain unchanged.

## Acceptance criteria

- `pnpm --filter @grasp-it/core build` passes
- `pnpm --filter @grasp-it/core test` passes
- A node with `id: "risk:invoice-rounding"` and `type: "risk"` is accepted by `normalizeNodeId`
  (or equivalent function) without being flagged as an unknown prefix
- A node with `id: "claim:a1b2c3"` and `type: "claim"` is accepted
- A node with `id: "decision:jwt-memory-only"` and `type: "decision"` is accepted
- No previously valid node IDs are rejected after the change

## Notes

- Read the file carefully before editing — `normalize-graph.ts` may have a more complex
  structure than a simple flat map. Do not break existing normalization logic.
- The `"risk"` type will only be valid in TypeScript once Task 43 is complete, but this
  normalization fix is a data-layer concern and can be implemented independently.

## References

- `docs/architecture/neo4j-schema.md` — Node ID Conventions table
- `grasp-it-plugin/packages/core/src/analyzer/normalize-graph.ts` — file to modify
- Related tasks: 43 (core types — adds `"risk"` to `NodeType`), 49 (tests)
