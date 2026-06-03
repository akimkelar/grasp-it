# Task 5: Schema Node and Relationship Updates

## Description

Update the domain-analyzer agent and grasp-po skill to emit the new schema nodes (`Feature`, `Actor`, `BusinessRule`, `Operation`, `Entity`) and relationships, and remove deprecated `Flow`/`Step` nodes and their relationships.

## Pre-requisites

- Task 3 (graph documentation) must be complete before this — the updated schema must be documented first
- Task 4 (Groovy/Grails support) should be complete or in progress — the domain-analyzer needs Groovy entry points to produce accurate domain decomposition for Grails codebases

## Actions

### 5.1 Update domain-analyzer.md

**File:** `grasp-it-plugin/agents/domain-analyzer.md`

**Key changes:**
- Replace the `domain → flow → step` output structure with `Domain → Feature → Operation` + standalone `Actor`, `BusinessRule`, `Entity`
- Remove `Flow` and `Step` node types entirely
- Remove `CONTAINS_FLOW`, `FLOW_STEP`, `CROSS_DOMAIN` relationship types
- Add new node types with ID prefixes:
  - `feature:<kebab-name>`
  - `operation:<kebab-name>`
  - `actor:<kebab-name>`
  - `business-rule:<kebab-name>`
  - `entity:<kebab-name>`
- Add new relationships:
  - `HAS_FEATURE` (Domain → Feature)
  - `HAS_OPERATION` (Feature → Operation)
  - `SEQUENCE` (Operation → Operation) — for ordered operation chains
  - `PERFORMED_BY` (Operation → Actor)
  - `RESTRICTED_FOR` (Operation → Actor)
  - `GOVERNS` (BusinessRule → Feature/Operation)
  - `USES_ENTITY` (Feature/Operation → Entity)
- Extend `CONSTRAINED_BY` to accept `Feature` and `BusinessRule` as source (previously `Decision` only)
- Extend `DECIDES` to target `Feature` and `BusinessRule` (previously `Claim` only)
- Add `IMPLEMENTED_BY` as a native bridge relationship with `status: "legacy" | "target" | "shared" | "planned"` and `confidence: float`
- Keep existing `Decision` and `Constraint` nodes and update `Decision.status` to include `"draft"` (`"draft" | "accepted" | "deprecated"`)
- Update the mermaid diagram in the agent file to reflect the new schema

### 5.2 Update grasp-po/SKILL.md

**File:** `grasp-it-plugin/skills/grasp-po/SKILL.md`

**Key changes:**
- Update the PO interview output schema to include `Actor`, `BusinessRule`, `Operation`, `Feature`, `Entity` node types
- Add `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY` relationship types
- Extend `DECIDES` to target `Feature` and `BusinessRule` (currently only targets `Claim`)
- Update `Decision` status to include `"draft"` (`"draft" | "accepted" | "deprecated"`)
- Remove any references to `Flow`/`Step` nodes

### 5.3 Update grasp-domain/SKILL.md

**File:** `grasp-it-plugin/skills/grasp-domain/SKILL.md`

- Minor update: the skill dispatches to domain-analyzer, which is being updated in 5.1
- Add note that Groovy/Grails entry point patterns are now supported
- Ensure the skill description is consistent with the new node types

### 5.4 Graph validation updates in `packages/core`

**Primary file:** `grasp-it-plugin/packages/core/src/schema.ts`

This file contains the Zod schema for graph validation and has these stale references that must be updated:

- **`EdgeTypeSchema`** (`z.enum([...])` at the top): remove `"contains_flow"`, `"flow_step"`, `"cross_domain"`; add `"has_feature"`, `"has_operation"`, `"sequence"`, `"performed_by"`, `"restricted_for"`, `"governs"`, `"uses_entity"`, `"implemented_by"`
- **`NODE_TYPE_ALIASES`**: remove `business_flow: "flow"`, `business_process: "flow"`, `task: "step"`, `business_step: "step"`; add appropriate aliases for new types
- **`EDGE_TYPE_ALIASES`**: remove `has_flow: "contains_flow"`, `next_step: "flow_step"`, `interacts_with: "cross_domain"`; add aliases for new relationship types
- **`GraphNodeSchema`** (`type: z.enum([...])` in the Zod object): remove `"flow"`, `"step"`; add `"feature"`, `"actor"`, `"business-rule"`, `"operation"`
- **`GraphNodeSchema.status`**: update from `z.enum(["proposed", "accepted", "implemented"])` to include `"planned"`, `"partial"`, `"deprecated"`, `"draft"`, `"active"` (all valid status values across the schema)

**Search for additional files:**
```bash
grep -r "flow\|step\|contains_flow\|flow_step\|cross_domain" grasp-it-plugin/packages/core/src --include="*.ts" -l
```

Ensure the validation layer in `packages/core`:
- Accepts `feature`, `actor`, `business-rule`, `operation`, `entity` as valid knowledge node types
- Accepts `has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`, `uses_entity`, `implemented_by` as valid relationship types
- Removes `flow`, `step`, `contains_flow`, `flow_step`, `cross_domain` (these are no longer valid)

### 5.5 Find and update legacy graph references

Search for any intermediate files, templates, or documentation that reference `Flow`/`Step`:
```bash
grep -r "Flow\|Step\|contains_flow\|flow_step\|cross_domain" . --include="*.md" --include="*.ts" --include="*.js" --include="*.py" -l
```

Update all references to use the new schema.

## Completion

When complete:
- domain-analyzer.md emits new node types and relationships
- grasp-po/SKILL.md reflects new schema
- No remaining references to Flow/Step in agent/skill files
- Graph validation accepts new schema
- Commit with message: `refactor: update schema nodes — add Feature/Actor/BusinessRule/Operation/Entity, remove Flow/Step`
- Push to remote