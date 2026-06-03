# Task 7: Neo4j Schema Setup (Constraints and Indexes)

## Description

The final schema in `docs/architecture/neo4j-schema.md` defines required constraints and recommended indexes for the Neo4j database, but no setup script or migration exists. This task creates a Cypher DDL script that applies all constraints and indexes, and ensures it is applied before any graph data is written.

## Pre-requisites

- Task 5 (Schema node updates) must be complete — constraints must match the final node labels

## Actions

### 7.1 Create Neo4j setup script

**New file:** `grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher`

Populate with the constraints and indexes from `docs/architecture/neo4j-schema.md`:

```cypher
-- Unique ID constraints (one per label)
CREATE CONSTRAINT file_id IF NOT EXISTS FOR (n:File) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT function_id IF NOT EXISTS FOR (n:Function) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT class_id IF NOT EXISTS FOR (n:Class) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT module_id IF NOT EXISTS FOR (n:Module) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT config_id IF NOT EXISTS FOR (n:Config) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT table_id IF NOT EXISTS FOR (n:Table) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT endpoint_id IF NOT EXISTS FOR (n:Endpoint) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT domain_id IF NOT EXISTS FOR (n:Domain) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT feature_id IF NOT EXISTS FOR (n:Feature) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT operation_id IF NOT EXISTS FOR (n:Operation) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT actor_id IF NOT EXISTS FOR (n:Actor) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT businessrule_id IF NOT EXISTS FOR (n:BusinessRule) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (n:Decision) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT constraint_id IF NOT EXISTS FOR (n:Constraint) REQUIRE n.id IS UNIQUE;

-- Kind separation index
CREATE INDEX kind_idx IF NOT EXISTS FOR (n) ON (n.kind);

-- Name search (kind-scoped)
CREATE INDEX codebase_name IF NOT EXISTS FOR (n) WHERE n.kind = "codebase" ON (n.name);
CREATE INDEX knowledge_name IF NOT EXISTS FOR (n) WHERE n.kind = "knowledge" ON (n.name);

-- Status filtering
CREATE INDEX feature_status IF NOT EXISTS FOR (n:Feature) ON (n.status);
CREATE INDEX operation_status IF NOT EXISTS FOR (n:Operation) ON (n.status);

-- Complexity filtering
CREATE INDEX function_complexity IF NOT EXISTS FOR (n:Function) ON (n.complexity);

-- Tag filtering
CREATE INDEX codebase_tags IF NOT EXISTS FOR (n) WHERE n.kind = "codebase" ON (n.tags);
CREATE INDEX knowledge_tags IF NOT EXISTS FOR (n) WHERE n.kind = "knowledge" ON (n.tags);
```

### 7.2 Run setup on Neo4j connection init

**Locate:** The file that establishes the Neo4j connection in the grasp skill pipeline. Search:
```bash
grep -r "neo4j\|bolt://\|neo4j://" grasp-it-plugin/ --include="*.ts" --include="*.mjs" --include="*.js" -l
```

Add a step that runs the setup script (or equivalent Cypher statements) once on first connection or startup — before any nodes are written. Use `IF NOT EXISTS` guards so re-running is safe.

### 7.3 Document the setup requirement

Add a note to `docs/architecture/neo4j-schema.md` (or a new `docs/architecture/neo4j-setup.md`) that the constraints and indexes in the schema must be applied before writing graph data. Reference `setup-neo4j-schema.cypher`.

## Completion

When complete:
- `setup-neo4j-schema.cypher` exists and covers all node labels from the final schema
- Setup is applied automatically on Neo4j connection init (or clearly documented as a manual step)
- Commit with message: `feat: add Neo4j schema setup script (constraints and indexes)`
- Push to remote
