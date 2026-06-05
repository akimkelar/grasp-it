# Task 49: Update tests for `kind`/`source`, `risk` node type, and new edge types

## Background

Several test files are out of sync with schema changes made in recent tasks. The gaps found:

1. **`knowledge-node-types.test.ts`** — test fixtures for knowledge nodes (domain, feature,
   operation, actor, entity, business-rule) are missing `kind` and `source` properties. No tests
   for Risk nodes or risk-related edge types (`has_risk`, `mitigated_by`).

2. **`schema.test.ts`** — no tests for the `risk` node type, its properties (`severity`,
   `probability`, `mitigation`), the `kind`/`source` properties on knowledge nodes, or the
   new edge types.

3. **`types.test.ts`** — contains a test that asserts there are exactly 26 edge types, but the
   actual count is now higher (the new types `has_risk` and `mitigated_by` were added in Task 43,
   and others were already added). The hardcoded count is stale.

**Dependency:** This task should be done after Task 43 (core types) is complete, since the new
types must exist before tests can reference them.

## Files to change

- `grasp-it-plugin/packages/core/src/__tests__/knowledge-node-types.test.ts`
- `grasp-it-plugin/packages/core/src/__tests__/schema.test.ts`
- `grasp-it-plugin/packages/core/src/types.test.ts` (if this file exists — check first)

## Required changes

Read each file before editing. The exact line numbers will differ from what was investigated;
always read first.

### 1. `knowledge-node-types.test.ts`

**Update existing knowledge node fixtures** to include `kind` and `source`:

```typescript
// Before:
{ id: "domain:invoicing", type: "domain", name: "Invoicing", ... }

// After:
{ id: "domain:invoicing", type: "domain", kind: "knowledge", source: "code-analysis", name: "Invoicing", ... }
```

Apply to all knowledge node fixtures (domain, feature, operation, actor, entity, business-rule).
Use `source: "code-analysis"` for nodes that would be produced by `/grasp-domain`, and
`source: "interview"` for nodes that would be produced by `/grasp-requirements`.

**Add Risk node tests:**

```typescript
it("accepts a risk node with all required properties", () => {
  const node = {
    id: "risk:invoice-rounding",
    type: "risk" as NodeType,
    kind: "knowledge",
    source: "interview",
    name: "Invoice rounding inconsistency",
    summary: "Rounding applied per-line vs total produces different results",
    severity: "high",
    probability: "medium",
    mitigation: "Always round at total level, not per-line",
    scope: ["invoicing"],
    tags: ["calculation", "finance"],
  };
  expect(GraphNodeSchema.parse(node)).toBeDefined();
});

it("accepts risk severity enum values", () => {
  for (const severity of ["low", "medium", "high", "critical"] as const) {
    const node = { id: `risk:test-${severity}`, type: "risk" as NodeType, kind: "knowledge", source: "interview", name: "Test", summary: "Test", severity };
    expect(GraphNodeSchema.parse(node)).toBeDefined();
  }
});
```

**Add edge type tests for `has_risk` and `mitigated_by`:**

```typescript
it("accepts has_risk edge type", () => {
  const edge = { source: "feature:invoicing", target: "risk:rounding", type: "has_risk" as EdgeType, direction: "forward" as const, weight: 1.0 };
  expect(GraphEdgeSchema.parse(edge)).toBeDefined();
});

it("accepts mitigated_by edge type", () => {
  const edge = { source: "risk:rounding", target: "decision:round-at-total", type: "mitigated_by" as EdgeType, direction: "forward" as const, weight: 0.9 };
  expect(GraphEdgeSchema.parse(edge)).toBeDefined();
});
```

### 2. `schema.test.ts`

**Add tests for `kind` and `source` on knowledge nodes:**

```typescript
it("accepts kind and source on knowledge nodes", () => {
  const node = {
    id: "feature:interview-scheduling",
    type: "feature",
    kind: "knowledge",
    source: "code-analysis",
    name: "Interview Scheduling",
    summary: "...",
    tags: [],
  };
  expect(GraphNodeSchema.parse(node)).toBeDefined();
});

it("accepts interview source on PO interview nodes", () => {
  const node = {
    id: "constraint:no-localstorage",
    type: "constraint",
    kind: "knowledge",
    source: "interview",
    name: "No localStorage",
    condition: "always",
    invariant: "JWT must not be stored in localStorage",
    scope: ["auth"],
    tags: [],
  };
  expect(GraphNodeSchema.parse(node)).toBeDefined();
});
```

### 3. `types.test.ts`

**Fix the stale edge type count.** Find the test that asserts a hardcoded count of edge types
(reported as 26). Update it to either:
- Count the actual current number of edge types (after Task 43 adds `has_risk` and `mitigated_by`)
- Or replace the hardcoded count with a dynamic check that validates all types in `EdgeType`
  are present in `EdgeTypeSchema` (preferred — prevents future staleness)

## Acceptance criteria

- `pnpm --filter @grasp-it/core test` passes with no failures
- Tests exist for the `risk` node type with `severity`, `probability`, `mitigation` properties
- Tests exist for `has_risk` and `mitigated_by` edge types
- Tests assert that `kind` and `source` are accepted on knowledge nodes
- The stale edge type count test is fixed and will not silently pass when new types are added

## References

- `docs/architecture/neo4j-schema.md` — PO Interview Layer (Risk, Claim, Concept), Shared Node
  Properties (`kind`, `source`), PO Interview Relationships (`has_risk`, `mitigated_by`)
- `grasp-it-plugin/packages/core/src/types.ts` — `NodeType`, `EdgeType`, `GraphNode` (after Task 43)
- `grasp-it-plugin/packages/core/src/schema.ts` — `GraphNodeSchema`, `EdgeTypeSchema` (after Task 43)
- Prerequisite: Task 43 (core types) must be complete before implementing this task
