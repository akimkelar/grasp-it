# Task 46 Report: Update `domain-analyzer` agent to emit `kind` and `source` on all produced nodes

## Summary

Updated `grasp-it-plugin/agents/domain-analyzer.md` to include `kind: "knowledge"` and `source: "code-analysis"` on all node templates produced by the domain-analyzer agent.

## Changes Made

1. **Added required fields note** at the top of the Output Schema section (lines 38-42):
   ```
   **Required Node Fields:** Every node produced by this agent must include:
   ```json
   "kind": "knowledge",
   "source": "code-analysis"
   ```
   ```

2. **Updated all 6 node templates** in the Output Schema section:
   - `domain` node (lines 59-67): added `kind` and `source` after `type`
   - `feature` node (lines 68-78): added `kind` and `source` after `type`
   - `operation` node (lines 79-89): added `kind` and `source` after `type`
   - `actor` node (lines 90-100): added `kind` and `source` after `type`
   - `business-rule` node (lines 101-111): added `kind` and `source` after `type`
   - `entity` node (lines 112-120): added `kind` and `source` after `type`

## Acceptance Criteria Verification

- Every node example in `domain-analyzer.md` includes `"kind": "knowledge"` and `"source": "code-analysis"` — **PASS**
- The agent instructions explicitly state these two fields are required on every output node — **PASS**
- No other functional changes to the agent prompt — **PASS**

## Files Modified

- `grasp-it-plugin/agents/domain-analyzer.md`
