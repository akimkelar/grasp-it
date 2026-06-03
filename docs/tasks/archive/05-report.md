# Task 5 Complete: Schema Node and Relationship Updates

## Summary

Updated the domain-analyzer agent, grasp-requirements skill, and graph validation schema to use the new schema nodes (`Feature`, `Actor`, `BusinessRule`, `Operation`, `Entity`) and removed deprecated `Flow`/`Step` nodes.

## Changes Made

### 5.1 domain-analyzer.md (agent)
- Replaced `domain → flow → step` hierarchy with `Domain → Feature → Operation` + standalone `Actor`, `BusinessRule`, `Entity`
- Added new node types with ID prefixes: `feature:<kebab-name>`, `operation:<kebab-name>`, `actor:<kebab-name>`, `business-rule:<kebab-name>`, `entity:<kebab-name>`
- Added new relationships: `HAS_FEATURE`, `HAS_OPERATION`, `SEQUENCE`, `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY`, `IMPLEMENTED_BY`
- Removed `contains_flow`, `flow_step`, `cross_domain` relationship types
- Added Groovy/Grails support note
- Added Mermaid diagram reference

### 5.2 grasp-requirements/SKILL.md
- Updated PO interview output schema to include `Actor`, `BusinessRule`, `Operation`, `Feature`, `Entity` node types
- Added `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY` relationship types
- Extended `DECIDES` to target `Feature` and `BusinessRule`
- Extended `CONSTRAINED_BY` to accept `Decision`, `Feature`, and `BusinessRule` as source
- Updated `Decision` status to include `"draft"` (`"draft" | "accepted" | "deprecated"`)
- Removed `Flow`/`Step` references

### 5.3 grasp-domain/SKILL.md
- Updated description to reflect new node types (features, operations, actors, business rules, entities)
- Added note about Groovy/Grails entry point pattern support
- Updated validation comment to reference new schema types

### 5.4 schema.ts (core validation)
- **EdgeTypeSchema**: Removed `contains_flow`, `flow_step`, `cross_domain`; Added `has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`, `uses_entity`, `implemented_by`
- **NODE_TYPE_ALIASES**: Removed `business_flow: "flow"`, `business_process: "flow"`, `task: "step"`, `business_step: "step"`, `actor: "entity"`; Added no new aliases for new types
- **EDGE_TYPE_ALIASES**: Removed `has_flow: "contains_flow"`, `next_step: "flow_step"`, `interacts_with: "cross_domain"`, `constrained_by: "constrained_by"`, `sub_concept_of: "sub_concept_of"` (these are identity mappings)
- **GraphNodeSchema.type**: Removed `"flow"`, `"step"`; Added `"feature"`, `"operation"`, `"actor"`, `"business-rule"`, `"entity"`
- **GraphNodeSchema.status**: Extended from `z.enum(["proposed", "accepted", "implemented"])` to `["proposed", "accepted", "implemented", "planned", "partial", "deprecated", "draft", "active"]`

### 5.5 types.ts (core types)
- **NodeType**: Updated to reflect new domain types (27 total: `domain`, `feature`, `operation`, `actor`, `business-rule`, `entity` replacing `flow`, `step`)
- **EdgeType**: Updated to include new relationships (45 total across 11 categories)
- **GraphNode.status**: Extended status union to include all valid values across the schema
- Added `permissions` and `restrictions` properties to `GraphNode` (for Actor nodes)
- Added `ruleText` property to `GraphNode` (for BusinessRule nodes)

### 5.6 domain-types.test.ts (test updates)
- Rewrote test fixture to use new node types (domain, feature, operation, actor, business-rule, entity)
- Updated edge types to use `has_feature`, `has_operation`, `performed_by`, `governs`, `uses_entity`
- Added tests for new edge types: `sequence`, `restricted_for`, `implemented_by`
- Added tests for new node properties: `permissions`, `restrictions`, `ruleText`
- Added tests for new status values (`planned`, `active`)

## Test Results

Core tests pass (schema.test.ts: 59 tests, domain-types.test.ts: 14 tests).

Two pre-existing test failures unrelated to this task:
- `language-registry.test.ts`: Hardcoded count (40) doesn't match actual (42) built-in language configs
- `framework-registry.test.ts`: Hardcoded count (10) doesn't match actual (11) built-in framework configs

## Files Changed

- `grasp-it-plugin/agents/domain-analyzer.md`
- `grasp-it-plugin/skills/grasp-requirements/SKILL.md`
- `grasp-it-plugin/skills/grasp-domain/SKILL.md`
- `grasp-it-plugin/packages/core/src/schema.ts`
- `grasp-it-plugin/packages/core/src/types.ts`
- `grasp-it-plugin/packages/core/src/__tests__/domain-types.test.ts`
- `grasp-it-plugin/packages/core/src/__tests__/schema.test.ts`