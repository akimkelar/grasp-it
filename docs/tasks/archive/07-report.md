# Task 7 Complete: Neo4j Schema Setup (Constraints and Indexes)

## Summary

Created a Cypher DDL script that applies all required constraints and indexes for the grasp-it knowledge graph, and documented the setup requirement in the schema documentation.

## Changes Made

### 7.1 Created Neo4j setup script

**New file:** `grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher`

The script covers:
- **15 unique ID constraints** — one per node label (File, Function, Class, Module, Config, Table, Endpoint, Domain, Feature, Operation, Actor, BusinessRule, Entity, Decision, Constraint)
- **Kind separation index** — distinguishes codebase vs knowledge subgraphs
- **Name search indexes** (kind-scoped) — for efficient name lookups in each subgraph
- **Status filtering indexes** — for Feature.status and Operation.status
- **Complexity filtering index** — for Function.complexity
- **Tag filtering indexes** (kind-scoped) — for codebase and knowledge tags
- **Relationship traversal index** — for weighted edge queries

All statements use `IF NOT EXISTS` guards for safe re-runs.

### 7.2 Connection init integration

**Status:** Not yet applicable — the plugin currently writes JSON files to disk (`.grasp-it/knowledge-graph.json`) rather than directly to Neo4j. No Neo4j driver or session code exists in the current codebase.

When Neo4j integration is added (via `/grasp-knowledge` or future graph storage), the setup script should be run on first connection before any nodes are written. The `setup-neo4j-schema.cypher` file is ready to be executed via:

```bash
cypher-shell -u <user> -p <pass> < grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher
```

Or programmatically via a Neo4j driver's session.execute() method.

### 7.3 Documented setup requirement

Added a "Setup and Maintenance" section to `docs/architecture/neo4j-schema.md` that:
- Documents how to apply the constraints and indexes (cypher-shell, Neo4j browser, programmatic)
- Notes when re-application is needed (fresh instance, after upgrade, schema changes)
- References the `setup-neo4j-schema.cypher` file

## Files Changed

- **Added:** `grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher` (new Cypher DDL script)
- **Modified:** `docs/architecture/neo4j-schema.md` (added Setup and Maintenance section)

## Verification

- The Cypher script syntax is valid for Neo4j 5.x (uses `IF NOT EXISTS` which is standard Neo4j DDL)
- All 15 node labels from the schema are covered (codebase: File, Function, Class, Module, Config, Table, Endpoint; knowledge: Domain, Feature, Operation, Actor, BusinessRule, Entity, Decision, Constraint)
- All constraints and indexes from the schema's "Indexes and Constraints" section are included
- The setup section in `neo4j-schema.md` properly references the script