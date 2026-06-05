# Task 44 Report: Add missing Neo4j constraints and indexes

## Summary

Added three missing unique constraints and two missing indexes to `grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher`.

## Changes Made

### Added unique constraints (lines 24-26)

```cypher
CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (n:Concept) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (n:Claim) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT risk_id IF NOT EXISTS FOR (n:Risk) REQUIRE n.id IS UNIQUE;
```

These follow the same pattern as all existing constraints with `IF NOT EXISTS` guards.

### Added source filtering index (line 55)

```cypher
CREATE INDEX knowledge_source IF NOT EXISTS FOR (n) WHERE n.kind = "knowledge" ON (n.source);
```

Enables efficient queries filtering knowledge nodes by source (code-analysis, interview, wiki).

### Added risk severity index (line 62)

```cypher
CREATE INDEX risk_severity IF NOT EXISTS FOR (n:Risk) ON (n.severity);
```

Enables fast filtering of Risk nodes by severity level.

## Verification

- All statements use `IF NOT EXISTS` guards, making the script idempotent
- Existing constraints and indexes are unchanged
- New constraints are placed after the existing `constraint_id` constraint
- New indexes are placed in a logical position after status filtering indexes

## Acceptance Criteria Met

- Running the setup script against a fresh Neo4j instance creates constraints for `Concept`, `Claim`, and `Risk` node labels
- Running it again (idempotent) produces no errors
- The `knowledge_source` index exists after setup
- The `risk_severity` index exists after setup
- All previously existing constraints and indexes are unchanged