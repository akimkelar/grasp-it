# Task 11: Update grasp-search Skill for New Node Types

## Description

The `grasp-search` skill (`skills/grasp-search/SKILL.md`) contains example Cypher queries
and references to node types. After the schema changes in Task 5, any queries referencing
`Flow`, `Step`, `CONTAINS_FLOW`, `FLOW_STEP`, or `CROSS_DOMAIN` will fail against a live
Neo4j database. The skill must be updated to query the new schema.

Additionally, the `grasp-gaps` and `grasp-diff` skills reference node types that must be
updated.

## Pre-requisites

- Task 5 (schema node updates) must be complete — the graph must contain new node types
  before queries against them are useful

## Actions

### 11.1 Update grasp-search example queries

**File:** `grasp-it-plugin/skills/grasp-search/SKILL.md`

Search the file for any of these patterns and update them:
```bash
grep -n "Flow\|Step\|contains_flow\|flow_step\|cross_domain\|:Flow\|:Step" \
  grasp-it-plugin/skills/grasp-search/SKILL.md
```

For any query that matches `(d:Domain)-[:CONTAINS_FLOW]->(f:Flow)`, replace with:
```cypher
(d:Domain)-[:HAS_FEATURE]->(f:Feature)
```

For any query that matches `(f:Flow)-[:FLOW_STEP]->(s:Step)`, replace with:
```cypher
(f:Feature)-[:HAS_OPERATION]->(op:Operation)
```

Add example queries for the new node types if the skill shows query examples:

**Find all features in a domain:**
```cypher
MATCH (d:Domain)-[:HAS_FEATURE]->(f:Feature)
WHERE d.kind = "knowledge"
RETURN d.name AS domain, f.name AS feature, f.status
ORDER BY d.name, f.name
```

**Find actors and their permitted operations:**
```cypher
MATCH (op:Operation)-[:PERFORMED_BY]->(a:Actor)
WHERE op.kind = "knowledge"
RETURN a.name AS actor, collect(op.name) AS operations
ORDER BY a.name
```

**Find business rules governing a feature:**
```cypher
MATCH (br:BusinessRule)-[:GOVERNS]->(f:Feature {id: $featureId})
WHERE br.kind = "knowledge"
RETURN br.name, br.ruleText, br.status
```

**Find code implementing a feature (bridge query):**
```cypher
MATCH (f:Feature {id: $featureId})-[r:IMPLEMENTED_BY]->(code)
RETURN labels(code)[0] AS codeType, code.name, code.filePath,
       r.status, r.confidence
ORDER BY r.confidence DESC
```

### 11.2 Update grasp-gaps skill

**File:** `grasp-it-plugin/skills/grasp-gaps/SKILL.md`

Search for `flow\|step\|Flow\|Step`:
```bash
grep -n "Flow\|Step\|contains_flow\|flow_step" \
  grasp-it-plugin/skills/grasp-gaps/SKILL.md
```

Update any references. The gaps skill describes what knowledge is "missing" from the graph —
if it lists `Flow` or `Step` as gap categories, update to `Feature`, `Operation`, `Actor`,
`BusinessRule`, `Entity`.

### 11.3 Update grasp-diff skill

**File:** `grasp-it-plugin/skills/grasp-diff/SKILL.md`

Same search-and-replace for the diff skill:
```bash
grep -n "Flow\|Step\|contains_flow\|flow_step\|cross_domain" \
  grasp-it-plugin/skills/grasp-diff/SKILL.md
```

The diff skill compares graph state before/after code changes — if it references `Flow`/`Step`
nodes in its comparison logic, update to the new node types.

### 11.4 Update grasp-knowledge skill

**File:** `grasp-it-plugin/skills/grasp-knowledge/SKILL.md`

```bash
grep -n "Flow\|Step\|contains_flow\|flow_step\|cross_domain" \
  grasp-it-plugin/skills/grasp-knowledge/SKILL.md
```

Update any references.

### 11.5 Verify all skill files are clean

After all updates, verify no skill file still references the removed node/edge types:
```bash
grep -r "flow\b\|step\b\|contains_flow\|flow_step\|cross_domain" \
  grasp-it-plugin/skills/ --include="*.md" -l
```

The only acceptable hits are if the word appears in a comment or explanation that says
"these types no longer exist / were removed."

## Completion

When complete:
- All skill SKILL.md files are free of deprecated node/edge type references
- `grasp-search` has working example queries for the new knowledge node types
- Commit with message: `feat: update skill query examples for new knowledge schema`
