# Task 31 Report: Add `"project"` to the `kind` Zod Enum in `schema.ts`

## Summary

Added `"project"` as a valid value in the `kind` Zod enum to allow the `Project` singleton node to pass schema validation.

## Changes Made

### 1. `grasp-it-plugin/packages/core/src/schema.ts` (line 442)
```typescript
// Before:
kind: z.enum(["codebase", "knowledge"]).optional(),

// After:
kind: z.enum(["codebase", "knowledge", "project"]).optional(),
```

### 2. `grasp-it-plugin/packages/core/src/types.ts` (line 112)
```typescript
// Before:
kind?: "codebase" | "knowledge";

// After:
kind?: "codebase" | "knowledge" | "project";
```

### 3. `grasp-it-plugin/packages/core/src/__tests__/schema.test.ts`
Added a test case to verify that `kind: "project"` passes schema validation:
```typescript
it("accepts kind 'project' for Project singleton nodes", () => {
  const graph = structuredClone(validGraph);
  (graph as any).kind = "project";
  const result = validateGraph(graph);
  expect(result.success).toBe(true);
  expect(result.issues).toEqual([]);
});
```

## Verification

- All 809 tests pass (`pnpm --filter @grasp-it/core test`)
- Lint check skipped - no ESLint config exists in the project (pre-existing issue)

## Wipe Query Safety

Searched for wipe/delete queries using `kind` property. Found none - all Neo4j wipe operations guard by node label (e.g., `:Project`), not by the `kind` property. The existing guard is sufficient and the addition of `"project"` to the enum does not introduce any new risk.

## Related Files

- `grasp-it-plugin/packages/core/src/schema.ts` - Zod schema definition
- `grasp-it-plugin/packages/core/src/types.ts` - TypeScript type definition
- `grasp-it-plugin/packages/core/src/persistence/index.ts` - `saveProjectMeta` writes `kind: "project"` (line 212)
- `docs/graph/architecture.md` - Documents `kind: "project"` for Project node