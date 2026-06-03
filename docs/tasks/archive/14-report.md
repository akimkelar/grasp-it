# Task 14 Completion Report: Update knowledge-graph-guide Agent for New Schema

## Summary
Updated `grasp-it-plugin/agents/knowledge-graph-guide.md` to align with the new schema introduced in Task 5.

## Changes Made

### 14.1 Node Types Table (Section Header Updated)
- Changed from "16 total: 5 code + 8 non-code + 3 domain" to "21 total: 7 codebase + 8 knowledge + 6 structural"
- Restructured table into three sections: Codebase (7 nodes), Knowledge (8 nodes), Structural (6 nodes)
- Added: `feature`, `actor`, `business-rule`, `operation`, `entity`, `decision`, `constraint`
- Removed: `flow`, `step`

### 14.2 Edge Types Table
- Changed from "29 total in 7 categories" to "36 total in 7 categories"
- Renamed "Domain" category to "Knowledge"
- Replaced `contains_flow`, `flow_step`, `cross_domain` with:
  `has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`, `governs`, `uses_entity`, `implemented_by`, `constrained_by`, `decides`

### 14.3 Domain Graph Specifics Section
- Replaced old three-level hierarchy (Domain → Flow → Step) with new schema:
  - Domain → Feature via `has_feature`
  - Feature → Operation via `has_operation`
  - Operations ordered via `sequence` edges
  - Actors perform operations via `performed_by`
  - Actors restricted from operations via `restricted_for`
  - BusinessRules govern via `governs`
  - Entities referenced via `uses_entity`
  - Code linked via `implemented_by` (status: legacy/target/shared/planned)
  - Decisions and Constraints via `decides` and `constrained_by`
- Removed outdated `domainMeta` field description

### 14.4 Domain Analysis Help Tip
- Updated jq example from `select(.type == "flow")` to `select(.type == "feature")`
- Updated description from "business flows and processes" to "business features, operations, and actors"

### 14.5 Node Count in Section Headers
- Node types header updated to reflect new count and categorization
- Edge types header updated to reflect new count

## Verification
- All old node types (`flow`, `step`) removed
- All new node types (`feature`, `actor`, `business-rule`, `operation`, `entity`, `decision`, `constraint`) added
- All old edge types (`contains_flow`, `flow_step`, `cross_domain`) removed
- All new knowledge edge types added
- Domain Graph Specifics describes new hierarchy (Domain → Feature → Operation)