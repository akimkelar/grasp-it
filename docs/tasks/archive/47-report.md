# Task 47 Report: Update `po-interviewer` agent — fix file naming, clarify role, add `kind`/`source` and Risk support

## Summary

Updated `grasp-it-plugin/agents/po-interviewer.md` to repurpose the agent as a graph serialization helper and add full Risk node support.

## Changes Made

### 1. Agent Description and Purpose (lines 1-19)
- Changed frontmatter `description` from "structured interview agent" to "graph serialization helper"
- Rewrote agent purpose: agent is NO LONGER an interviewer — `/grasp-requirements` skill handles interviews inline
- New role: take interview context and serialize it into `pr-nodes.json` and `pr-edges.json`

### 2. Input Section (lines 21-27)
- Replaced `TOPIC` with `INTERVIEW_CONTEXT` as the primary input
- Updated file references from `po-nodes.json`/`po-edges.json` to `pr-nodes.json`/`pr-edges.json`

### 3. Serialization Protocol (lines 29-69)
- Replaced the old "Interview Protocol" with a "Serialization Protocol"
- Removed all question-asking behavior
- Added explicit `kind: "knowledge"` and `source: "interview"` requirements for each node type
- Added "5. Risks" section with specific triggers for when to create Risk nodes:
  - Warnings about implementation hazards
  - Edge cases in calculation logic
  - Customer-facing exposure from wrong implementation choices
  - Data-loss hazards during migration or refactoring
  - Rule interaction issues

### 4. Output Format — Nodes (lines 71-149)
- Changed file reference from `po-nodes.json` to `pr-nodes.json`
- Added `kind: "knowledge"` and `source: "interview"` to all existing node templates (concept, decision, constraint, claim)
- Added complete Risk node template with all required properties:
  - `id`, `type`, `kind`, `source`, `name`, `summary`
  - `severity` (low|medium|high|critical)
  - `probability` (low|medium|high)
  - `mitigation` (optional, empty string if unknown)
  - `scope`, `tags`
- Added Risk node properties clarification section

### 5. Output Format — Edges (lines 151-220)
- Changed file reference from `po-edges.json` to `pr-edges.json`
- Added `has_risk` edge examples:
  - `feature:<id>` -> `risk:<id>`
  - `operation:<id>` -> `risk:<id>`
- Added `mitigated_by` edge examples:
  - `risk:<id>` -> `decision:<id>`
  - `risk:<id>` -> `constraint:<id>`

### 6. Completion Signal (lines 223-232)
- Updated to reflect serialization role (not interview role)
- Simplified to just serialize and signal completion

### 7. Important Rules (lines 234-240)
- Kept rules1-4 but updated wording for serialization context
- Added rule 5: "Create Risk nodes proactively"

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Agent description clearly states role as graph-writing helper | Done |
| All `po-nodes.json` references replaced with `pr-nodes.json` | Done |
| All `po-edges.json` references replaced with `pr-edges.json` | Done |
| Every existing node type includes `kind: "knowledge"` and `source: "interview"` | Done |
| Complete Risk node template present with all required properties | Done |
| Edges section includes `has_risk` and `mitigated_by` examples | Done |
| Agent instructions explain when to create a Risk node | Done |
| No regressions to existing concept, decision, constraint, claim formats | Done |

## Files Changed

- `grasp-it-plugin/agents/po-interviewer.md` — full rewrite to update role, add Risk support, fix file naming
