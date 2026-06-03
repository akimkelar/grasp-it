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
- Remove `contains_flow`, `flow_step`, `cross_domain` relationship types
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
- Keep existing `IMPLEMENTED_BY` but extend its `status` values to include `"legacy" | "target" | "shared" | "planned"`
- Keep existing `Decision`, `Constraint`, `Decision` nodes and `DECIDES`/`CONSTRAINED_BY` relationships (no changes to PO interview layer)
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

### 5.4 Graph validation updates

**Search for:** Any code that validates or serializes knowledge graph nodes
```bash
grep -r "flow\|step\|domain\|decision\|constraint" grasp-it-plugin/packages/core/src --include="*.ts" -l
```

**Update any files that:**
- Hardcode node type lists (look for `kind === "knowledge"` validation logic)
- Validate relationship types
- Serialize graph output

Ensure the validation layer:
- Accepts `Feature`, `Actor`, `BusinessRule`, `Operation`, `Entity` nodes
- Accepts new relationship types
- Does not reject `Flow`/`Step` as legacy (graceful ignore, not hard error)

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