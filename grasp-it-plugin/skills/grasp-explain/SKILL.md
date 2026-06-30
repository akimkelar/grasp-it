---
name: grasp-explain
description: Use when you need a deep-dive explanation of a specific file, function, or module. Delegates to /grasp-search for graph context, then reads the source file and produces a structured deep-dive (role, structure, connections, data flow, patterns).
argument-hint: [file-path | path:function | function-name]
allowed-tools: Bash, Read
---

# /grasp-explain

Provide a thorough, in-depth explanation of a specific code component. Combines the graph context from `/grasp-search` with a direct read of the source file to produce a structured deep-dive that covers the component's architectural role, internal structure, external connections, data flow, and patterns worth understanding.

**Always start with `/grasp-search`.** The graph is the first and cheapest source of business context — it tells you which functions, classes, and relationships are relevant before you spend context reading the source file. Only read the source file after `/grasp-search` has narrowed the scope.

The full Neo4j schema, node labels, and relationship types live in `/grasp-search` (Approach A for code elements, Approach B for code-analysis knowledge, Approach C for concept knowledge). Refer to it whenever the relationship directions or edge names matter — the codebase edges use named relationship types (`:CONTAINS`, `:CALLS`, `:IMPORTS`, etc.), not a generic `:RELATES`.

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

1. Query Neo4j to confirm any Codebase node exists for this project:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) WHERE n.kind = 'codebase' RETURN count(n) > 0 AS hasGraph"
   ```
2. If the query returns no rows (or `hasGraph` is false), tell the user to run `/grasp` first.
3. If Neo4j query fails, report the error and **STOP**.

### Phase 2: Locate the target node via /grasp-search

The argument is one of:
- a file path (e.g., `src/auth/login.ts`)
- a `path:function` pair (e.g., `src/auth.ts:login`)
- a bare function or class name (e.g., `login`)

Pick the matching search strategy and resolve a single target node:

**For a file path** — use `/grasp-search` Approach A (Codebase lookup) with the path, then pick the `File` node whose `filePath` matches most closely:

```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$ARGUMENTS'] AS terms MATCH (seed) WHERE seed.kind = 'codebase' AND seed:File AND any(t IN terms WHERE toLower(seed.filePath) CONTAINS toLower(t)) RETURN seed.id AS id, seed.name AS name, seed.filePath AS filePath, seed.summary AS summary, seed.complexity AS complexity, seed.languageNotes AS languageNotes ORDER BY size(seed.filePath) LIMIT 5"
```

**For a `path:function` pair** — split on the last `:`, then use Approach A with the function name scoped to the file:

```bash
# Split (shell)
FILE_PATH="${ARGUMENTS%:*}"
FUNC_NAME="${ARGUMENTS##*:}"

node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$FUNC_NAME'] AS terms MATCH (fn) WHERE fn.kind = 'codebase' AND (fn:Function OR fn:Class) AND any(t IN terms WHERE toLower(fn.name) CONTAINS toLower(t)) AND toLower(fn.filePath) CONTAINS toLower('$FILE_PATH') RETURN labels(fn)[0] AS type, fn.id AS id, fn.name AS name, fn.filePath AS filePath, fn.lineRange AS lineRange, fn.summary AS summary, fn.complexity AS complexity, fn.languageNotes AS languageNotes ORDER BY size(fn.filePath) LIMIT 5"
```

**For a bare name** — use `/grasp-search` Approach 1 (broad text search) to surface candidates, then narrow with Approach A to pick the best `Function` or `Class` match:

```bash
# Approach 1 — broad discovery across code + knowledge nodes:
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$ARGUMENTS'] AS terms MATCH (seed) WHERE any(t IN terms WHERE toLower(seed.name) CONTAINS toLower(t) OR toLower(seed.summary) CONTAINS toLower(t)) WITH seed, size([t IN terms WHERE toLower(seed.name) CONTAINS toLower(t) OR toLower(seed.summary) CONTAINS toLower(t)]) AS score RETURN labels(seed)[0] AS type, seed.kind AS kind, seed.name AS name, score, seed.filePath AS filePath, seed.summary AS summary ORDER BY score DESC LIMIT 10"
```

If Approach 1 returns multiple strong candidates of different node types, use Approach A to filter to `Function`/`Class`/`File` only and pick the best one. If the candidates are still ambiguous, surface the top 2–3 to the user and ask which to explain.

If `/grasp-search` returns no candidates at all, tell the user the target was not found in the graph. Suggest running `/grasp` first, or trying a different identifier (a full file path, a more specific name, or a substring from the summary).

Note the resolved node's `id`, `name`, `filePath`, `lineRange`, `summary`, `complexity`, and `languageNotes` — these feed Phase 4 (Read) and Phase 5 (Explain).

### Phase 3: Expand to the graph neighborhood via /grasp-search

The graph neighborhood is what makes the explanation "deep" rather than a code summary. Pull it from `/grasp-search`:

**Connected nodes and edges** — Approach 4 (1-hop traversal), the `via` column tells you the relationship type:

```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (start) WHERE start.id = '$NODE_ID' MATCH (start)-[r]-(neighbor) WHERE neighbor <> start RETURN DISTINCT labels(neighbor)[0] AS type, neighbor.kind AS kind, neighbor.name AS name, neighbor.summary AS summary, type(r) AS via ORDER BY type, name"
```

**Internal structure** — for file-level targets, the children live in `[:CONTAINS]` edges. For class-level targets, `methods` and `properties` are properties on the Class node (there is no `Class→Function` edge — match by `filePath` if you need sibling functions):

```bash
# File target:
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (file:File {id: '$NODE_ID'})-[:CONTAINS]->(child) WHERE child:Function OR child:Class OR child:Module RETURN labels(child)[0] AS type, child.name AS name, child.lineRange AS lineRange, child.summary AS summary ORDER BY child.lineRange[0]"

# Class target:
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (cls:Class {id: '$NODE_ID'}) RETURN cls.name, cls.methods, cls.properties, cls.summary"
```

**Architectural layer:**

```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {id: '$NODE_ID'})-[:IN_LAYER]->(l) RETURN l.name AS name, l.description AS description"
```

**Business context** — which features, operations, or rules this code implements (if any) — Approach 5 pattern, walked in reverse (what knowledge nodes point at this code via `IMPLEMENTED_BY`):

```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n {id: '$NODE_ID'})<-[:IMPLEMENTED_BY]-(kn) WHERE kn.kind = 'knowledge' RETURN labels(kn)[0] AS type, kn.name AS name, kn.summary AS summary, kn.status AS status LIMIT 20"
```

If any of these queries fail, report the error and **STOP** — the deep-dive is built on top of this neighborhood.

### Phase 4: Read the source file

The graph is the "why and where"; the source is the "what". Use the Read tool on the resolved `filePath`:

- If `lineRange` is available and the target is a function or class, read the file (or just those lines) — line numbers from the graph are reliable.
- If the target is a `File` node, read the whole file.
- If the target was resolved as a class with `methods` populated, read the file to confirm the method signatures and bodies.

```text
Read $FILE_PATH
# (or: Read with offset/limit to focus on $LINE_RANGE)
```

The source is the source of truth for "what the code actually does" — the graph only tells you how it fits in.

### Phase 5: Produce the deep-dive

With the graph neighborhood from `/grasp-search` and the source from Phase 4, produce a structured deep-dive covering:

1. **Role in the architecture** — which layer this lives in (from Phase 3) and why it exists. If the graph surfaces business features or rules this code implements, name them.
2. **Internal structure** — functions, classes, properties, methods it contains (from `[:CONTAINS]` edges, the Class's `methods` property, and the source). Group by purpose, not by declaration order.
3. **External connections** — what calls it, what it calls, what it depends on, what it implements (from the 1-hop neighborhood and `IMPLEMENTED_BY` edges). Distinguish inbound from outbound.
4. **Data flow** — inputs (parameters, `READS_FROM`), processing (the body), outputs (returns, `WRITES_TO`, `PUBLISHES`). Walk the inputs through to the outputs in plain language.
5. **Patterns, idioms, design decisions** — anything in the code worth understanding: error handling style, async patterns, dependency injection, transaction boundaries, etc. The graph's `complexity` and `tags` can hint at which patterns matter; the source confirms them.
6. **Gotchas and complexity** — non-obvious behavior, edge cases the code handles, anything a reader might get wrong. Call out anything the graph `summary` doesn't already make obvious.

Use specific `file:line` references and quote short code snippets where they clarify the structure. Link to connected components by name and file path so the reader can follow up. If the graph returned a layer, explain how this component relates to that layer's purpose.

If the target was not found, report that clearly and suggest `/grasp` to build the graph, then retry.
