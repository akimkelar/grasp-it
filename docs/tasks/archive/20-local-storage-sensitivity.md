# Task 20: Investigate Local-Only Data Storage

## Context

The knowledge graph is moving to a cloud-hosted Neo4j database. Multiple users will work with it simultaneously. Some data is currently stored locally (in `.grasp-it/` directory, `meta.json`, `fingerprints.json`, `domain-graph.json`, etc.) instead of in the database. This could cause issues in multi-user scenarios.

## Objective

Inventory all data currently stored locally (outside Neo4j) that the graph system depends on. Classify each item as:
- **Must be cloud-stored** — graph integrity depends on it; local-only causes multi-user conflicts
- **Can be local** — cache or transient data safe to keep on disk
- **Undecided** — needs design decision

## Investigation Checklist

### 1. Data Inventory
Enumerate ALL local files and directories in `.grasp-it/` and any other project-local storage:
- `meta.json`
- `fingerprints.json`
- `knowledge-graph.json`
- `domain-graph.json`
- `intermediate/` directory
- Any other files

For each, determine:
- What script/tool produces it
- What script/tool consumes it
- What data it contains
- Whether Neo4j has equivalent data (or could have)

### 2. Sensitivity Analysis

| Data | Produced By | Consumed By | Cloud-Stored Equivalent? | Sensitivity |
|------|-------------|-------------|--------------------------|-------------|
| ... | ... | ... | ... | ... |

Sensitivity criteria:
- **Critical** — graph correctness breaks if this is stale/wrong across users
- **Important** — functionality impaired but recoverable
- **Low** — purely local optimization/cache

### 3. Multi-User Scenario Analysis

If User A runs `/grasp` and User B runs `/grasp-diff` simultaneously:
- Which local files would conflict?
- What would break?
- How should this be handled?

### 4. Scripts to Examine

- `grasp-it-plugin/src/skills/grasp/` — main analysis
- `grasp-it-plugin/src/skills/grasp-diff/` — diff detection
- `grasp-it-plugin/src/skills/grasp-domain/` — domain analysis
- `grasp-it-plugin/src/skills/grasp-knowledge/` — knowledge mining
- `grasp-it-plugin/packages/core/src/staleness.ts`
- `grasp-it-plugin/packages/core/src/fingerprint.ts`
- `grasp-it-plugin/scripts/` — any build/deploy scripts
- `grasp-it-plugin/packages/core/src/persistence/` — Neo4j interaction code

### 5. Neo4j Schema Review

Cross-reference with `docs/architecture/neo4j-schema.md` — does Neo4j already store the data that we currently keep locally? Can local data be migrated to cloud storage?

## Expected Output

1. **Comprehensive table** mapping each local data file to:
   - Producer script(s)
   - Consumer script(s)
   - Data contents (summary)
   - Cloud-stored equivalent (if any)
   - Sensitivity classification
   - Recommendation (cloud/local/deprecate)

2. **Gap analysis** — what's NOT in Neo4j but should be for multi-user correctness

3. **Recommendations** — which local data should migrate to Neo4j, which can remain local, and any architectural changes needed