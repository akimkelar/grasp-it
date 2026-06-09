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

SKILL_REAL=$(realpath ~/.agents/skills/grasp-explain 2>/dev/null || readlink -f ~/.agents/skills/grasp-explain 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-explain 2>/dev/null || readlink -f ~/.copilot/skills/grasp-explain 2>/dev/null || echo "")
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
    echo "[grasp-explain] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-explain] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
```

### Phase 1: Verify Graph Exists

1. Query Neo4j for the `Project` singleton:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p"
   ```
2. If Neo4j returns no results, tell the user to run `/grasp` first.

### Phase 2: Find the Target Node

Query Neo4j for the component: "$ARGUMENTS"
```bash
# For file paths (e.g., src/auth/login.ts)
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (f:File) WHERE f.name CONTAINS '$ARGUMENTS' OR f.filePath CONTAINS '$ARGUMENTS' RETURN f LIMIT 5"
# For function/method names
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (fn:Function) WHERE fn.name CONTAINS '$ARGUMENTS' RETURN fn LIMIT 5"
```
If Neo4j query fails, report the error and **STOP**.

Note the exact node `id`, `type`, `summary`, `tags`, and `complexity` (if available).

### Phase 3: Find Connected Edges

Query Neo4j for edges connected to the target node:
```bash
# Outgoing edges (what this node calls/imports/depends on)
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[r]->(m) RETURN n.name, type(r), labels(m)[0], m.name LIMIT 30"
# Incoming edges (what calls/imports/depends on this node)
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (m)-[r]->(n {name: '$NODE_NAME'}) RETURN m.name, type(r), labels(m)[0], n.name LIMIT 30"
```
If Neo4j query fails, report the error and **STOP**.

### Phase 4: Read Connected Nodes

Query Neo4j for neighbor node details:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'}) RETURN n.name, n.summary, n.kind, labels(n)[0]"
```

Build the component's neighborhood context.

### Phase 5: Identify the Layer

Query Neo4j for layer membership:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {name: '$NODE_NAME'})-[:IN_LAYER]->(l) RETURN l.name, l.description"
```
If Neo4j query fails, report the error and **STOP**.

### Phase 6: Read the Actual Source File

Read the source file at the node's `filePath` for the deep-dive analysis.

### Phase 7: Explain the Component in Context

Explain the component:
   - Its role in the architecture (which layer, why it exists)
   - Internal structure (functions, classes it contains — from `CONTAINS`/`PART_OF` edges)
   - External connections (what it imports, what calls it, what it depends on — from edges)
   - Data flow (inputs → processing → outputs — from source code)
   - Explain clearly, assuming the reader may not know the programming language
   - Highlight any patterns, idioms, or complexity worth understanding
