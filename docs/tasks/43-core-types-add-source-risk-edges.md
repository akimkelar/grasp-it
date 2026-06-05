# Task 43: Update core TypeScript types and Zod schema for `kind`, `source`, `risk`, and new edge types

## Background

The schema was updated (see `docs/architecture/neo4j-schema.md`) to add:
- A `source` property on all knowledge nodes (`"code-analysis"` | `"interview"` | `"wiki"`)
- A `kind` property on all nodes (`"codebase"` | `"knowledge"` | `"project"`)
- A first-class `Risk` node type (PO Interview Layer)
- Two new edge types: `has_risk` and `mitigated_by`

None of these are reflected in the TypeScript types or Zod validation schemas yet.

## Files to change

- `grasp-it-plugin/packages/core/src/types.ts`
- `grasp-it-plugin/packages/core/src/schema.ts`

## Required changes

### `types.ts`

**1. Add `"risk"` to the `NodeType` union** (currently lines 1–8):
```typescript
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "feature" | "operation" | "actor" | "business-rule" | "entity"
  | "article" | "topic" | "claim" | "source"
  | "decision" | "constraint"
  | "risk";   // ← add this
```

**2. Add `"has_risk"` and `"mitigated_by"` to the `EdgeType` union** (currently lines 11–23):
```typescript
  | "decides" | "constrained_by" | "supports" | "applies_in" | "sub_concept_of"
  | "has_risk" | "mitigated_by";   // ← add these
```

**3. Add `kind`, `source`, and Risk-specific properties to the `GraphNode` interface** (currently lines 43–70). Add alongside the existing optional fields:
```typescript
kind?: "codebase" | "knowledge" | "project";
source?: "code-analysis" | "interview" | "wiki";
// Risk node
severity?: "low" | "medium" | "high" | "critical";
probability?: "low" | "medium" | "high";
mitigation?: string;
```

### `schema.ts`

**4. Add `"risk"` to the `GraphNodeSchema` Zod enum** (currently lines 379–386 of the `.type` field):
```typescript
  "domain", "feature", "operation", "actor", "business-rule", "entity",
  "article", "topic", "claim", "source",
  "decision", "constraint",
  "risk",   // ← add
```

**5. Add `kind` and `source` optional fields to `GraphNodeSchema`** (within the same Zod object, alongside other fields):
```typescript
kind: z.enum(["codebase", "knowledge", "project"]).optional(),
source: z.enum(["code-analysis", "interview", "wiki"]).optional(),
```

**6. Add `"has_risk"` and `"mitigated_by"` to `EdgeTypeSchema`** (currently lines 4–17, in the `"Conversation"` group):
```typescript
  "decides", "constrained_by", "supports", "applies_in", "sub_concept_of",
  "has_risk", "mitigated_by",   // ← add
```

**7. Add risk-related aliases to `EDGE_TYPE_ALIASES`** (currently lines 83–134). Add these entries:
```typescript
"mitigates": "mitigated_by",
"addresses": "mitigated_by",
"risk_of": "has_risk",
"has_risk_of": "has_risk",
```

## Acceptance criteria

- `pnpm --filter @grasp-it/core build` passes with no TypeScript errors
- `pnpm --filter @grasp-it/core test` passes
- A graph node `{ id: "risk:rounding", type: "risk", kind: "knowledge", source: "interview", severity: "high", probability: "medium" }` passes `GraphNodeSchema` validation
- An edge `{ source: "feature:invoice", target: "risk:rounding", type: "has_risk" }` passes `EdgeTypeSchema` validation
- An edge `{ source: "risk:rounding", target: "decision:use-banker-rounding", type: "mitigated_by" }` passes validation

## References

- `docs/architecture/neo4j-schema.md` — authoritative schema (Shared Node Properties, PO Interview Layer, PO Interview Relationships sections)
- `docs/architecture/schema-evolution-plan.md` — settled decisions (PO Interview nodes section)
- Related tasks: 44 (Neo4j setup), 45 (normalize-graph), 49 (tests)
