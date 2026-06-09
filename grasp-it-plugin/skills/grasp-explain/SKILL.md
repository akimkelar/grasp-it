---
name: grasp-explain
description: Use when you need a deep-dive explanation of a specific file, function, or module in the codebase
argument-hint: [file-path]
---

# /grasp-explain

Provide a thorough, in-depth explanation of a specific code component using the Neo4j knowledge graph.

## Graph Structure Reference

The knowledge graph in Neo4j has these node types:
- **Codebase nodes**: File, Function, Class, Module, Concept, Config, Service, Table, Endpoint, Pipeline, Schema, Resource
- **Knowledge nodes**: Domain, Feature, Operation, Actor, BusinessRule, Entity, Decision, Constraint, Article, Topic, Claim, Source

Key relationships:
- `(:Function)-[:CALLS]->(:Function)`
- `(:Function)-[:PART_OF]->(:Class)`
- `(:File)-[:DEFINES]->(:Function)`
- `(:Class)-[:DEFINES]->(:Function)`
- `(:File)-[:CONTAINS]->(:Function)`
- `(:Domain)-[:HAS_FEATURE]->(:Feature)`
- `(:Feature)-[:HAS_OPERATION]->(:Operation)`

## Instructions

### Phase 0: Verify Graph Exists

1. Query Neo4j for the `Project` singleton:
   ```bash
   SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p"
   ```
2. If Neo4j returns no results, tell the user to run `/grasp` first.

### Phase 1: Find the Target Node

Query Neo4j for the component: "$ARGUMENTS"
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
# For file paths (e.g., src/auth/login.ts)
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (f:File) WHERE f.name CONTAINS '$ARGUMENTS' OR f.filePath CONTAINS '$ARGUMENTS' RETURN f LIMIT 5"
# For function/method names
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (fn:Function) WHERE fn.name CONTAINS '$ARGUMENTS' RETURN fn LIMIT 5"
```
If Neo4j query fails, report the error and **STOP**.

Note the exact node `id`, `type`, `summary`, `tags`, and `complexity` (if available).

### Phase 2: Find Connected Edges

Query Neo4j for edges connected to the target node:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
# Outgoing edges (what this node calls/imports/depends on)
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[r]->(m) RETURN n.name, type(r), labels(m)[0], m.name LIMIT 30"
# Incoming edges (what calls/imports/depends on this node)
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (m)-[r]->(n {name: '$NODE_NAME'}) RETURN m.name, type(r), labels(m)[0], n.name LIMIT 30"
```
If Neo4j query fails, report the error and **STOP**.

### Phase 3: Read Connected Nodes

Query Neo4j for neighbor node details:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'}) RETURN n.name, n.summary, n.kind, labels(n)[0]"
```

Build the component's neighborhood context.

### Phase 4: Identify the Layer

Query Neo4j for layer membership:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[:IN_LAYER]->(l) RETURN l.name, l.description"
```
If Neo4j query fails, report the error and **STOP**.

### Phase 5: Read the Actual Source File

Read the source file at the node's `filePath` for the deep-dive analysis.

### Phase 6: Explain the Component in Context

Explain the component:
   - Its role in the architecture (which layer, why it exists)
   - Internal structure (functions, classes it contains — from `CONTAINS`/`PART_OF` edges)
   - External connections (what it imports, what calls it, what it depends on — from edges)
   - Data flow (inputs → processing → outputs — from source code)
   - Explain clearly, assuming the reader may not know the programming language
   - Highlight any patterns, idioms, or complexity worth understanding
