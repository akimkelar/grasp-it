---
name: grasp-diff
description: Use when you need to analyze git diffs or pull requests to understand what changed, affected components, and risks
---

# /grasp-diff

Analyze the current code changes against the knowledge graph stored in Neo4j.

## Graph Structure Reference

The knowledge graph JSON has this structure:
- `project` — {name, description, languages, frameworks, analyzedAt, gitCommitHash}
- `nodes[]` — each has {id, type, name, filePath?, summary, tags[], complexity, languageNotes?}
  - Code node types: file, function, class, module, concept
  - Non-code node types: config, document, service, table, endpoint, pipeline, schema, resource
  - Domain/knowledge node types: domain, flow, step, article, entity, topic, claim, source
  - IDs use the node type as prefix, e.g. `file:path`, `function:path:name`, `config:path`, `article:path`
- `edges[]` — each has {source, target, type, direction, weight}
  - Key types: imports, contains, calls, depends_on, configures, documents, deploys, triggers, has_feature, has_operation, performed_by, governed_by, implemented_by, related, cites
- `layers[]` — each has {id, name, description, nodeIds[]}
- `tour[]` — each has {order, title, description, nodeIds[]}

## How to Read Efficiently

1. Use Grep to search within the JSON for relevant entries BEFORE reading the full file
2. Only read sections you need — don't dump the entire graph into context
3. Node names and summaries are the most useful fields for understanding
4. Edges tell you how components connect — follow imports and calls for dependency chains

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

SKILL_REAL=$(realpath ~/.agents/skills/grasp-diff 2>/dev/null || readlink -f ~/.agents/skills/grasp-diff 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-diff 2>/dev/null || readlink -f ~/.copilot/skills/grasp-diff 2>/dev/null || echo "")
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
    echo "[grasp-diff] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-diff] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
```

### Phase 1: Graph Freshness Check

Before reading the graph, check whether it is stale relative to the current HEAD:

1. Query Neo4j `Project` singleton for `gitCommitHash` using `run-query.mjs`:
   ```bash
   NEO4J_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash" 2>/dev/null)
   if [ -z "$NEO4J_RESULT" ] || echo "$NEO4J_RESULT" | grep -q "null\|empty"; then
     echo "Error: Failed to query Neo4j for project metadata. Cannot proceed without Neo4j."
     echo "Ensure Neo4j is running and accessible, then re-run /grasp-diff."
     exit 1
   fi
   LAST_COMMIT=$(echo "$NEO4J_RESULT" | jq -r '.gitCommitHash // empty')
   if [ -z "$LAST_COMMIT" ] || [ "$LAST_COMMIT" = "null" ]; then
     echo "Error: Neo4j returned no gitCommitHash. Run /grasp first to create the Project singleton."
     exit 1
   fi
   ```
2. Compare `LAST_COMMIT` to `git rev-parse HEAD` — if they differ, the graph is stale
3. If stale, print a warning:
   > "Graph may be stale — last analyzed at `<lastCommit>` (`N` commits behind HEAD). Results may not reflect recent changes. Run `/grasp` to update."
4. **Continue execution regardless** — the warning is advisory only

> **Note:** This check queries Neo4j for the `Project` singleton's `gitCommitHash`. Neo4j is the only source of truth — there is no JSON fallback.

### Phase 1: Verify Graph Exists

1. Check that a `Project` singleton exists in Neo4j:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p"
   ```
   If Neo4j returns no results, tell the user to run `/grasp` first.

### Phase 2: Get the changed files list

1. If on a branch with uncommitted changes: `git diff --name-only`
2. If on a feature branch: `git diff main...HEAD --name-only` (or the base branch)
3. If the user specifies a PR number: get the diff from that PR

### Phase 3: Read project metadata only

Use Grep or Read with a line limit to extract just the `"project"` section for context.

### Phase 4: Find nodes for changed files

For each changed file path, use Grep to search the knowledge graph for:
- Nodes with matching `"filePath"` values (e.g., `grep "changed/file/path"`)
- This finds file-level nodes (including non-code types) AND function/class nodes defined in those files
- Note the `id` values of all matched nodes

### Phase 5: Find connected edges (1-hop)

For each matched node ID, Grep for that ID in the edges to find:
- What imports or depends on the changed nodes (upstream callers)
- What the changed nodes import or call (downstream dependencies)
- These are the "affected components" — things that might break or need updating

### Phase 6: Identify affected layers

Grep for the matched node IDs in the `"layers"` section to determine which architectural layers are touched.

### Phase 7: Provide structured analysis

- **Changed Components**: What was directly modified (with summaries from matched nodes)
- **Affected Components**: What might be impacted (from 1-hop edges)
- **Affected Layers**: Which architectural layers are touched and cross-layer concerns
- **Risk Assessment**: Based on node `complexity` values, number of cross-layer edges, and blast radius (number of affected components)
- Suggest what to review carefully and any potential issues

### Phase 8: Write diff overlay for dashboard

After producing the analysis, write the diff data to `.grasp-it/diff-overlay.json` so the dashboard can visualize changed and affected components. The file contains:
```json
{
  "version": "1.0.0",
  "baseBranch": "<the base branch used>",
  "generatedAt": "<ISO timestamp>",
  "changedFiles": ["<list of changed file paths>"],
  "changedNodeIds": ["<node IDs from step 4>"],
  "affectedNodeIds": ["<node IDs from step 5, excluding changedNodeIds>"]
}
```
After writing, tell the user they can run `/grasp-it:grasp-dashboard` to see the diff overlay visually.
