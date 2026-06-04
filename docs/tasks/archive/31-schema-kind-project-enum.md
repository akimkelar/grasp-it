# Task 31: Add `"project"` to the `kind` Zod Enum in `schema.ts`

## Objective

Add `"project"` as a valid value in the `kind` Zod enum so the `Project` singleton node passes schema validation. Currently the enum only allows `"codebase"` and `"knowledge"`, but `saveProjectMeta` writes `kind: "project"` to Neo4j. This is safe today because wipe queries guard by Neo4j node label, but any future code that validates all graph nodes against `KnowledgeGraphSchema` would reject or silently corrupt the singleton.

## Background

Found by the type system consistency audit. See:
- `grasp-it-plugin/packages/core/src/schema.ts` — `kind` Zod enum (approx. line 442)
- `grasp-it-plugin/packages/core/src/types.ts` — `kind?: "codebase" | "knowledge"` (approx. line 112)
- `grasp-it-plugin/packages/core/src/persistence/index.ts` — `saveProjectMeta` writes `kind: "project"` (line ~212)
- `docs/graph/architecture.md` — Project node section documents `kind: "project"`

## Implementation Checklist

### 1. Update Zod schema

- [ ] Open `grasp-it-plugin/packages/core/src/schema.ts`
- [ ] Find the `kind` enum (used in `KnowledgeGraphSchema` or `GraphNodeSchema`)
- [ ] Add `"project"` to the enum:
  ```typescript
  kind: z.enum(["codebase", "knowledge", "project"]).optional()
  ```

### 2. Update TypeScript types

- [ ] Open `grasp-it-plugin/packages/core/src/types.ts`
- [ ] Find the `kind` union type on `GraphNode` or `KnowledgeGraph`
- [ ] Add `"project"`:
  ```typescript
  kind?: "codebase" | "knowledge" | "project"
  ```

### 3. Verify wipe query safety

- [ ] Search the codebase for any wipe/delete queries using `kind`
- [ ] Confirm all wipe queries use `WHERE n.kind = "codebase"` (not a negation like `WHERE n.kind != "project"`) — the existing guard is sufficient but confirm it

### 4. Tests

- [ ] Add a test in schema validation tests that a node with `kind: "project"` passes `KnowledgeGraphSchema` validation without error
- [ ] Run `pnpm --filter @grasp-it/core test`

## Key Files

- `grasp-it-plugin/packages/core/src/schema.ts`
- `grasp-it-plugin/packages/core/src/types.ts`
- `grasp-it-plugin/packages/core/src/persistence/index.ts`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/31-report.md`
- [ ] Move this file to `docs/tasks/archive/31-schema-kind-project-enum.md`
- [ ] Commit: `git add -A && git commit -m "fix: add project to kind enum in schema and types"`
- [ ] Push: `git push`
