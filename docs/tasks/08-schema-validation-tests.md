# Task 8: Schema Validation Tests for New Node and Edge Types

## Description

After Task 5 updates `packages/core/src/schema.ts` to add the new knowledge node types
(`feature`, `actor`, `business-rule`, `operation`, `entity`) and edge types
(`has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`,
`uses_entity`, `implemented_by`) and removes deprecated ones (`flow`, `step`,
`contains_flow`, `flow_step`, `cross_domain`), the existing test suite must be updated to
match the new schema and new coverage must be added.

## Pre-requisites

- Task 5 (schema node updates) must be complete — `schema.ts` must already be updated

## Why this matters

There is a direct conflict between the current tests and the planned schema changes:

- `domain-types.test.ts` currently tests that `flow`, `step`, `contains_flow`, `flow_step`,
  and `cross_domain` are **valid** — after Task 5 they will be **invalid**. If not updated,
  the tests will fail after Task 5 is applied, or worse, they will be silently bypassed.
- `schema.test.ts` has a test (`auto-fixes new node type aliases: container->service, doc->document, business_flow->flow, etc.`) that asserts `business_flow` maps to `flow` — this alias target becomes invalid after Task 5.
- No tests currently verify that `feature`, `actor`, `business-rule`, `operation`, `entity`,
  `has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`,
  `uses_entity`, or `implemented_by` are accepted as valid types.

## Actions

### 8.1 Update domain-types.test.ts

**File:** `grasp-it-plugin/packages/core/src/__tests__/domain-types.test.ts`

This file currently tests the old `Domain → Flow → Step` schema. It must be updated to test
the new `Domain → Feature → Operation` schema.

**Changes:**
- Replace `flow` node type with `feature` node type in the test fixture
- Replace `step` node type with `operation` node type
- Replace `contains_flow` edge type with `has_feature`
- Replace `flow_step` edge type with `has_operation`
- Remove the `cross_domain` edge type test (that edge type no longer exists)
- Update alias normalization tests:
  - Remove `business_flow → flow` and `business_step → step` alias tests
  - Add alias tests for the new types (e.g. `business_domain → domain` still valid)
- Remove `domainMeta` field tests if they were only relevant to `flow` nodes
- Add new tests:
  - `validates feature node type`
  - `validates actor node type`
  - `validates operation node type`
  - `validates entity node type`
  - `validates business-rule node type`
  - `validates has_feature edge type`
  - `validates has_operation edge type`
  - `validates sequence edge type`
  - `validates performed_by edge type`
  - `validates restricted_for edge type`
  - `validates governs edge type`
  - `validates uses_entity edge type`
  - `validates implemented_by edge type`

### 8.2 Update schema.test.ts alias assertions

**File:** `grasp-it-plugin/packages/core/src/__tests__/schema.test.ts`

In the `Extended node/edge types` describe block, the test:
```
auto-fixes new node type aliases: container->service, doc->document, business_flow->flow, etc.
```
currently asserts `business_flow` maps to `flow`. After Task 5, `flow` is no longer a valid
target type. Either:
- Remove `business_flow` from the alias list (if it maps to nothing)
- Update it to map to `feature` (if `business_flow → feature` becomes the new canonical alias)

Also update any alias chain no-cycle tests if `flow` or `step` values are removed from
`NODE_TYPE_ALIASES`.

### 8.3 Add new knowledge node type test suite

**File:** `grasp-it-plugin/packages/core/src/__tests__/knowledge-node-types.test.ts` (new)

Create a new test file that covers the full knowledge subgraph:

```typescript
import { describe, it, expect } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

// Fixture: a minimal but complete knowledge graph exercising all new node types
const knowledgeGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: { /* ... */ },
  nodes: [
    { id: "domain:invoicing", type: "domain", name: "Invoicing", ... },
    { id: "feature:invoice-assignment", type: "feature", name: "Invoice Assignment",
      status: "planned", ... },
    { id: "operation:assign-invoice", type: "operation", name: "Assign Invoice",
      status: "implemented", ... },
    { id: "actor:manager", type: "actor", name: "Manager", ... },
    { id: "entity:invoice", type: "entity", name: "Invoice", ... },
    { id: "business-rule:manager-approval", type: "business-rule",
      name: "Manager Approval Required", status: "active", ruleText: "...", ... },
  ],
  edges: [
    { source: "domain:invoicing", target: "feature:invoice-assignment",
      type: "has_feature", direction: "forward", weight: 1.0 },
    { source: "feature:invoice-assignment", target: "operation:assign-invoice",
      type: "has_operation", direction: "forward", weight: 1.0 },
    { source: "operation:assign-invoice", target: "actor:manager",
      type: "performed_by", direction: "forward", weight: 0.9 },
    { source: "operation:assign-invoice", target: "entity:invoice",
      type: "uses_entity", direction: "forward", weight: 0.9 },
    { source: "business-rule:manager-approval", target: "feature:invoice-assignment",
      type: "governs", direction: "forward", weight: 1.0 },
  ],
  layers: [],
  tour: [],
};
```

Tests to include:
- `validates a complete knowledge subgraph` — round-trips the full fixture
- `feature status values: planned, partial, implemented are valid`
- `business-rule status values: active, deprecated, proposed are valid`
- `decision status values: draft, accepted, deprecated are valid` (Decision node)
- `sequence edge connects two operations`
- `restricted_for edge connects operation to actor`
- `implemented_by edge connects feature to file` (cross-graph bridge)
- `implemented_by status values: legacy, target, shared, planned are valid`
- `flow and step node types are rejected` — verify the old types now fail validation
- `contains_flow, flow_step, cross_domain edge types are rejected`

### 8.4 Verify tests pass after schema update

Run the test suite after both the schema update (Task 5) and the test updates (this task):

```bash
pnpm --filter @grasp-it/core test
```

All tests must pass. The test suite must not contain any remaining references to `flow`,
`step`, `contains_flow`, `flow_step`, or `cross_domain` as valid types.

## Completion

When complete:
- `domain-types.test.ts` tests the new schema (no `flow`/`step` nodes)
- `knowledge-node-types.test.ts` exists and covers all 8 knowledge node types and all 8 new
  edge types
- `schema.test.ts` alias tests do not reference removed types as valid targets
- All tests pass: `pnpm --filter @grasp-it/core test`
- Commit with message: `test: update schema tests for new knowledge node types (Feature/Actor/BusinessRule/Operation/Entity)`
