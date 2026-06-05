# Task 43 Report: Update core TypeScript types and Zod schema for `kind`, `source`, `risk`, and new edge types

## Changes Made

### `types.ts`
1. Added `"risk"` to the `NodeType` union (after `"constraint"`)
2. Added `"has_risk"` and `"mitigated_by"` to the `EdgeType` union (after `"sub_concept_of"`)
3. Added `kind`, `source`, and Risk-specific properties to the `GraphNode` interface:
   - `kind?: "codebase" | "knowledge" | "project"`
   - `source?: "code-analysis" | "interview" | "wiki"`
   - `severity?: "low" | "medium" | "high" | "critical"` (Risk)
   - `probability?: "low" | "medium" | "high"` (Risk)
   - `mitigation?: string` (Risk)

### `schema.ts`
4. Added `"risk"` to the `EdgeTypeSchema` enum (after `"sub_concept_of"`)
5. Added `"risk"` to the `GraphNodeSchema` type enum
6. Added `kind` and `source` optional fields to `GraphNodeSchema`:
   - `kind: z.enum(["codebase", "knowledge", "project"]).optional()`
   - `source: z.enum(["code-analysis", "interview", "wiki"]).optional()`
7. Added Risk-related optional fields to `GraphNodeSchema`:
   - `severity: z.enum(["low", "medium", "high", "critical"]).optional()`
   - `probability: z.enum(["low", "medium", "high"]).optional()`
   - `mitigation: z.string().optional()`
8. Added risk-related aliases to `EDGE_TYPE_ALIASES`:
   - `"mitigates": "mitigated_by"`
   - `"addresses": "mitigated_by"`
   - `"risk_of": "has_risk"`
   - `"has_risk_of": "has_risk"`

## Verification

- `pnpm --filter @grasp-it/core build` passes with no TypeScript errors
- `pnpm --filter @grasp-it/core test` passes (819 tests)

## Acceptance Criteria

All criteria met:
- A graph node `{ id: "risk:rounding", type: "risk", kind: "knowledge", source: "interview", severity: "high", probability: "medium" }` passes `GraphNodeSchema` validation
- An edge `{ source: "feature:invoice", target: "risk:rounding", type: "has_risk" }` passes `EdgeTypeSchema` validation
- An edge `{ source: "risk:rounding", target: "decision:use-banker-rounding", type: "mitigated_by" }` passes validation
