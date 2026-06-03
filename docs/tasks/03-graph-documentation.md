# Task 3: Graph Documentation

## Status

**Documentation already exists.** All four files under `docs/graph/` were created and are present:

- `docs/graph/architecture.md`
- `docs/graph/outdating-rules.md`
- `docs/graph/quality-rules.md`
- `docs/graph/seeding-rules.md`

This task is now a **validation and consistency check**, not a creation task.

## Description

Validate that the existing `docs/graph/` files are internally consistent with each other and with `docs/architecture/neo4j-schema.md`. Fix any inconsistencies found.

## Actions

### 3.1 Validate docs/graph/architecture.md

**File:** `docs/graph/architecture.md`

Check that it describes:
- The two subgraphs (codebase and knowledge) and how they relate
- All node types: codebase (`File`, `Function`, `Class`, `Module`, `Config`, `Table`, `Endpoint`); knowledge (`Domain`, `Feature`, `Operation`, `Actor`, `BusinessRule`, `Entity`, `Decision`, `Constraint`)
- All relationship types (structural, behavioral, product/business, PO interview, bridge)
- The `kind` property separation strategy
- The `IMPLEMENTED_BY` bridge with correct `status` values (`"legacy"|"target"|"shared"|"planned"`)
- ID conventions for each node type
- No references to removed nodes (`Flow`, `Step`) or removed relationships (`CONTAINS_FLOW`, `FLOW_STEP`, `CROSS_DOMAIN`)

### 3.2 Validate docs/graph/outdating-rules.md

**File:** `docs/graph/outdating-rules.md`

Check that it describes:
- The `kind = "codebase"` wipe pattern (single-DB, `kind`-scoped)
- Knowledge staleness signals aligned with the final node set
- Correct `IMPLEMENTED_BY.status` values (`"legacy"|"target"|"shared"|"planned"`)
- No references to `Flow`/`Step`

### 3.3 Validate docs/graph/quality-rules.md

**File:** `docs/graph/quality-rules.md`

Check that quality rules are achievable with the final schema nodes and relationships. Ensure:
- Rules reference only valid node types from the final schema
- Validation queries use valid Cypher against the single-DB schema
- No references to removed node types

### 3.4 Validate docs/graph/seeding-rules.md

**File:** `docs/graph/seeding-rules.md`

Check that it accurately describes what each script and LLM agent produces:
- `extract-structure.mjs` and `extract-import-map.mjs` produce structural facts (no business semantics)
- `extract-domain-context.py` produces entry points and file signatures (raw material for LLM)
- `/grasp-domain` domain-analyzer LLM produces `Domain`, `Feature`, `Operation`, draft `BusinessRule`, `Entity` nodes
- `/grasp-requirements` produces `Actor`, confirmed `BusinessRule`, `Decision`, `Constraint`, `Operation` sequences
- `Actor` nodes require `/grasp-requirements` only — scripts produce no actor signals
- No references to removed nodes

## Completion

When complete:
- All four documentation files are internally consistent and match `docs/architecture/neo4j-schema.md`
- No contradictions between docs/graph/ and docs/architecture/
- Commit with message: `docs: validate and fix graph documentation consistency`