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
- **Knowledge nodes**: Domain, Feature, Operation, Actor, BusinessRule, Entity, Decision, Constraint, Risk, Concept, Article, Topic, Claim, Source

Key relationships:
- `(:Function)-[:CALLS]->(:Function)`
- `(:Function)-[:PART_OF]->(:Class)`
- `(:File)-[:DEFINES]->(:Function)`
- `(:Domain)-[:HAS_FEATURE]->(:Feature)`
- `(:Feature)-[:HAS_OPERATION]->(:Operation)`
- `(:Operation)-[:PERFORMED_BY]->(:Actor)`
- `(:Feature)-[:GOVERNED_BY]->(:BusinessRule)`

## Instructions

### Phase 0: Setup

Resolve `PROJECT_ROOT`, `PLUGIN_ROOT`, and `GRASP_SKILL_DIR`:

```bash
PROJECT_ROOT="${PWD}"

COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi

SKILL_REAL=$(realpath ~/.agents/skills/grasp-chat 2>/dev/null || readlink -f ~/.agents/skills/grasp-chat 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-chat 2>/dev/null || readlink -f ~/.copilot/skills/grasp-chat 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

# Probe Claude plugin cache first — it always has the freshly-updated version.
CACHE_BASE="$HOME/.claude/plugins/cache/grasp-it/grasp-it"
LATEST_CACHE=$(ls -d "$CACHE_BASE"/*/ 2>/dev/null | sort -V | tail -1 | sed 's|/$||')

PLUGIN_ROOT=""
for candidate in \
  "$LATEST_CACHE" \
  "$HOME/.grasp-it-plugin" \
  "$SELF_RELATIVE" \
  "$COPILOT_SELF_RELATIVE" \
  "$HOME/.opencode/grasp-it/grasp-it-plugin" \
  "$HOME/.pi/grasp-it/grasp-it-plugin" \
  "$HOME/grasp-it/grasp-it-plugin"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done

# Upgrade to newer cache version if one exists and is newer than resolved PLUGIN_ROOT.
if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/package.json" ]; then
  PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "0")
  CACHE_VERSION=$(jq -r '.version' "$LATEST_CACHE/package.json" 2>/dev/null || echo "0")
  if [ "$(printf '%s\n' "$CACHE_VERSION" "$PLUGIN_VERSION" | sort -V | tail -1)" = "$CACHE_VERSION" ] \
     && [ "$CACHE_VERSION" != "$PLUGIN_VERSION" ]; then
    echo "[grasp-chat] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-chat] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
```

### Phase 1: Verify Graph Exists

1. Query Neo4j to confirm any Codebase node exists for this project:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n:Codebase) WHERE n.projectId = 'project:singleton' RETURN count(n) > 0 AS hasGraph"
   ```
2. If Neo4j returns no rows (or `hasGraph` is false), tell the user to run `/grasp` first.

### Phase 2: Get Project Context

Project name, description, languages, and frameworks come from the input graph passed by the calling agent (the graph that `/grasp` produced) — they are not stored on a `:Project` node any more (Task G removed the singleton). Read them from the assembled `KnowledgeGraph.project` payload on the input context.

### Phase 3: Search for Relevant Nodes

Query Neo4j for nodes matching the user's query:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) WHERE toLower(n.name) CONTAINS toLower('$ARGUMENTS') OR toLower(n.summary) CONTAINS toLower('$ARGUMENTS') RETURN n.name, n.kind, n.summary LIMIT 50"
```
If Neo4j query fails, report the error and **STOP**.

Note the node IDs of all matching nodes.

### Phase 4: Find Connected Edges

For each matched node ID, query for connected edges:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[r]->(m) RETURN n.name, type(r), m.name LIMIT 30"
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (m)-[r]->(n {name: '$NODE_NAME'}) RETURN m.name, type(r), n.name LIMIT 30"
```

This gives you the 1-hop subgraph around the query.

### Phase 5: Read Layer Context

Query for layer membership:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[:IN_LAYER]->(l) RETURN l.name, l.description"
```

### Phase 6: Answer the Query

Answer the query using only the relevant subgraph:
   - Reference specific files, functions, and relationships from the graph
   - Explain which layer(s) are relevant and why
   - Be concise but thorough — link concepts to actual code locations
   - If the query doesn't match any nodes, say so and suggest related terms from the graph
