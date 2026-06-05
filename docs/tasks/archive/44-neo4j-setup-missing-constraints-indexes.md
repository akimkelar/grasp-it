# Task 44: Add missing Neo4j constraints and indexes to setup script

## Background

The Neo4j schema setup script was not updated when `Concept`, `Claim`, and `Risk` were promoted
to first-class node types, and when the `source` property was added to all knowledge nodes.

Three unique constraints and two indexes documented in `docs/architecture/neo4j-schema.md` are
missing from the actual Cypher setup file that runs against Neo4j.

## File to change

`grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher`

## Required changes

### Missing unique constraints (add after existing `constraint_id` entry)

```cypher
CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (n:Concept) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (n:Claim) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT risk_id IF NOT EXISTS FOR (n:Risk) REQUIRE n.id IS UNIQUE;
```

### Missing indexes (add in the indexes section)

```cypher
-- Source filtering (code-analysis vs interview vs wiki)
CREATE INDEX knowledge_source IF NOT EXISTS FOR (n) WHERE n.kind = "knowledge" ON (n.source);

-- Risk severity filtering
CREATE INDEX risk_severity IF NOT EXISTS FOR (n:Risk) ON (n.severity);
```

## Context

All `CREATE CONSTRAINT` and `CREATE INDEX` statements in this file already use `IF NOT EXISTS`
guards, so re-running the script is safe. The new statements must follow the same pattern.

The `knowledge_source` index enables efficient queries like "all nodes produced from interviews"
vs "all nodes mined from code" without full-graph scans.

The `risk_severity` index enables filtering risks by severity (e.g., show only `critical` and
`high` risks for a feature) without scanning all Risk nodes.

## Acceptance criteria

- Running the setup script against a fresh Neo4j instance creates constraints for `Concept`,
  `Claim`, and `Risk` node labels
- Running it again (idempotent) produces no errors
- The `knowledge_source` index exists after setup
- The `risk_severity` index exists after setup
- All previously existing constraints and indexes are unchanged

## References

- `docs/architecture/neo4j-schema.md` — Indexes and Constraints section (see `concept_id`,
  `claim_id`, `risk_id`, `knowledge_source`, `risk_severity`)
- Related tasks: 43 (core types), 45 (normalize-graph)
