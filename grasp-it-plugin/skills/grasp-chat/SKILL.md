---
name: grasp-chat
description: Use when you need to ask questions about a codebase or understand code using a knowledge graph
argument-hint: [query]
---

# /grasp-chat

Answer questions about a codebase using the knowledge graph stored in Neo4j.

> **Works for non-developers too.** If you do not have the codebase locally, you can still query the knowledge graph as long as Neo4j credentials are configured (see `~/.grasp-it/neo4j.env` or the project `.env`). You do not need to run `/grasp` yourself — a developer must have built the graph first.

## Graph Structure Reference

The knowledge graph in Neo4j has these node types:
- **Codebase nodes**: File, Function, Class, Module, Concept, Config, Service, Table, Endpoint, Pipeline, Schema, Resource
- **Knowledge nodes**: Domain, Feature, Operation, Actor, BusinessRule, Entity, Decision, Constraint, Article, Topic, Claim, Source

Key relationships:
- `(:Function)-[:CALLS]->(:Function)`
- `(:Function)-[:PART_OF]->(:Class)`
- `(:File)-[:DEFINES]->(:Function)`
- `(:Domain)-[:HAS_FEATURE]->(:Feature)`
- `(:Feature)-[:HAS_OPERATION]->(:Operation)`
- `(:Operation)-[:PERFORMED_BY]->(:Actor)`
- `(:Feature)-[:GOVERNED_BY]->(:BusinessRule)`

## Instructions

### Phase 0: Verify Graph Exists

1. Query Neo4j for the `Project` singleton:
   ```bash
   SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p"
   ```
2. If Neo4j returns no results, tell the user to run `/grasp` first.

### Phase 1: Get Project Context

Query for project metadata:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.name, p.description, p.languages, p.frameworks"
```
If Neo4j query fails, report the error and **STOP**.

### Phase 2: Search for Relevant Nodes

Query Neo4j for nodes matching the user's query:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) WHERE toLower(n.name) CONTAINS toLower('$ARGUMENTS') OR toLower(n.summary) CONTAINS toLower('$ARGUMENTS') RETURN n.name, n.kind, n.summary LIMIT 50"
```
If Neo4j query fails, report the error and **STOP**.

Note the node IDs of all matching nodes.

### Phase 3: Find Connected Edges

For each matched node ID, query for connected edges:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[r]->(m) RETURN n.name, type(r), m.name LIMIT 30"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (m)-[r]->(n {name: '$NODE_NAME'}) RETURN m.name, type(r), n.name LIMIT 30"
```

This gives you the 1-hop subgraph around the query.

### Phase 4: Read Layer Context

Query for layer membership:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[:IN_LAYER]->(l) RETURN l.name, l.description"
```

### Phase 5: Answer the Query

Answer the query using only the relevant subgraph:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph
