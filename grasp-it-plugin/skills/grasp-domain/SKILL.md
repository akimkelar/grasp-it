---
name: grasp-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /grasp knowledge graph.
argument-hint: [--full]
---

# /grasp-domain

Extracts business domain knowledge — domains, features, operations, actors, business rules, and entities — from a codebase and produces an interactive domain flow graph in the dashboard.

## How It Works

- If a knowledge graph already exists in Neo4j, derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists in Neo4j, performs a lightweight scan: file tree + entry point detection + sampled files
- Use `--full` flag to force a fresh scan even if a knowledge graph exists
- Groovy/Grails entry point patterns (controllers, services, domain classes) are automatically recognized

## Graph Schema

**All nodes created by this skill carry `kind: "knowledge"` and `source: "code-analysis"`.** This
distinguishes code-mined knowledge from specialist-described knowledge (`source: "interview"`)
and enables queries that separate implemented facts from planned intent.

Node types produced by this skill:

- `domain` — a business domain or bounded context
- `feature` — a named product capability
- `operation` — a meaningful action within a feature
- `actor` — a user role or system agent
- `business-rule` — a high-level business policy
- `entity` — a named business object

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`

Set `PROJECT_ROOT` to the current working directory.

**Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.grasp-it/` written there is destroyed when the session ends, taking the domain graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[grasp-domain] Detected git worktree at $PROJECT_ROOT"
      echo "[grasp-domain] Redirecting output to main repo root: $MAIN_ROOT"
      echo "[grasp-domain] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
```

Use `$PROJECT_ROOT` (not the bare CWD) for every reference to "the current project" / `<project-root>` in subsequent phases.

**Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/grasp-domain` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

Resolve the plugin root like this:

```bash
SKILL_REAL=$(realpath ~/.agents/skills/grasp-domain 2>/dev/null || readlink -f ~/.agents/skills/grasp-domain 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-domain 2>/dev/null || readlink -f ~/.copilot/skills/grasp-domain 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
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

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the grasp-it plugin root."
  echo "Checked:"
  echo "  - $HOME/.grasp-it-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/grasp-domain>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/grasp-domain>}"
  echo "  - $HOME/.opencode/grasp-it/grasp-it-plugin"
  echo "  - $HOME/.pi/grasp-it/grasp-it-plugin"
  echo "  - $HOME/grasp-it/grasp-it-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi

# Validate that the resolved PLUGIN_ROOT has all required skill files.
# If the installed plugin is outdated (e.g., ~/.grasp-it-plugin is an older version
# that lacks run-query.mjs and push-domain-graph.mjs), fall back to the Claude cache.
if [ ! -f "$PLUGIN_ROOT/skills/grasp-domain/run-query.mjs" ]; then
  CACHE_BASE="$HOME/.claude/plugins/cache/grasp-it/grasp-it"
  LATEST_CACHE=$(ls -d "$CACHE_BASE"/*/  2>/dev/null | sort -V | tail -1 | sed 's|/$||')
  if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/skills/grasp-domain/run-query.mjs" ]; then
    echo "[grasp-domain] WARNING: Installed plugin at $PLUGIN_ROOT is outdated."
    echo "[grasp-domain] Falling back to cache version: $LATEST_CACHE"
    PLUGIN_ROOT="$LATEST_CACHE"
  else
    echo "[grasp-domain] ERROR: Plugin files are missing. Re-install the plugin."
    echo "  Run: /plugin update && /reload-plugins"
    echo "HARD STOP: Cannot continue without run-query.mjs."
    exit 1
  fi
fi
```

Use `$PLUGIN_ROOT` for every reference to agent definitions in subsequent phases.

### Phase 1: Git Staleness Check

Before deriving domain knowledge, check whether the underlying knowledge graph is stale relative to the current HEAD:

1. Query Neo4j `Project` singleton for `gitCommitHash` using `run-query.mjs`:
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   NEO4J_RESULT=$(node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash" 2>/dev/null)
   if [ -z "$NEO4J_RESULT" ] || echo "$NEO4J_RESULT" | grep -q "null\|empty"; then
     echo "Error: Failed to query Neo4j for project metadata. Cannot proceed without Neo4j."
     echo "Ensure Neo4j is running and accessible, then re-run /grasp-domain."
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
   > "Graph may be stale — last analyzed at `<lastCommit>` (`N` commits behind HEAD). Results may not reflect recent code changes. Run `/grasp` to update."
4. **Continue execution regardless** — the warning is advisory only

> **Note:** This check queries Neo4j for the `Project` singleton's `gitCommitHash`. Neo4j is the only source of truth — there is no JSON fallback.

5. **Apply Neo4j schema if needed (Bug C fix):** Before any writes to Neo4j, ensure the schema constraints and indexes are in place. This prevents `MERGE` operations and unique-constraint-dependent queries from failing.
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   # Detect already-applied schema: query for one well-known constraint (project_id)
   SCHEMA_CHECK=$(node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "SHOW CONSTRAINTS" 2>/dev/null)
   if echo "$SCHEMA_CHECK" | grep -q "project_id"; then
     echo "[grasp-domain] Neo4j schema already applied."
   else
     echo "[grasp-domain] Applying Neo4j schema (first-use setup)..."
     # Apply schema via cypher-shell if available, otherwise via driver
     if command -v cypher-shell >/dev/null 2>&1; then
       source "$SKILL_DIR/neo4j-config-loader.mjs" 2>/dev/null || true
       { NEO4J_URI="neo4j://localhost:7687" NEO4J_USERNAME="neo4j" NEO4J_PASSWORD="password"; }
       if [ -f "$SKILL_DIR/neo4j-config-loader.mjs" ]; then
         . <(node -e "import('$SKILL_DIR/neo4j-config-loader.mjs').then(m=>{const c=m.getNeo4jConfig('$PROJECT_ROOT');console.log('NEO4J_URI='+c.NEO4J_URI);console.log('NEO4J_USERNAME='+c.NEO4J_USERNAME);console.log('NEO4J_PASSWORD='+c.NEO4J_PASSWORD);})" 2>/dev/null)2>/dev/null || true
       fi
       cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" --format plain -f "$GRASP_SKILL_DIR/setup-neo4j-schema.cypher" 2>/dev/null && \
         echo "[grasp-domain] Neo4j schema applied successfully." || \
         echo "[grasp-domain] Warning: schema setup failed via cypher-shell"
     else
       # Driver path: apply schema line by line via run-query.mjs
       while IFS= read -r line && [ -n "$line" ]; do
         [ "${line:0:1}" = "/" ] && continue  # skip Cypher comments
         node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$line" 2>/dev/null || true
       done < "$GRASP_SKILL_DIR/setup-neo4j-schema.cypher"
       echo "[grasp-domain] Neo4j schema applied via driver."
     fi
   fi
   ```

### Phase 2: Detect Existing Graph and Preflight Staleness

**Standalone mode:** If `Project.gitCommitHash` is absent (meaning `/grasp` has never run), the skill runs in lightweight standalone mode. In this mode, `IMPLEMENTED_BY` edges cannot be produced because there is no existing knowledge graph with `:File`/`:Function`/`:Class` nodes to link to. The domain analysis will still produce domain elements, but they will not be connected to implementation details.

1. Check if `Project` singleton has `gitCommitHash` (meaning `/grasp` has run):
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   PROJECT_META=$(node "$SKILL_DIR/load-project-meta.mjs" "$PROJECT_ROOT" 2>/dev/null)
   GIT_COMMIT_HASH=$(echo "$PROJECT_META" | jq -r '.gitCommitHash // empty')

   if [ -z "$GIT_COMMIT_HASH" ]; then
     echo "[grasp-domain] Warning: No full /grasp analysis found." >&2
     echo "[grasp-domain] Running in standalone mode — IMPLEMENTED_BY edges will not be produced." >&2
     echo "[grasp-domain] Run /grasp first for best results, then re-run /grasp-domain." >&2
     HAS_CODEBASE_GRAPH="false"
   else
     HAS_CODEBASE_GRAPH="true"
   fi
   ```

2. Query Neo4j for the `Project` singleton to get `domainCommit`:
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash, p.domainCommit"
   ```
   If Neo4j returns no results, the graph does not exist. Report "No knowledge graph found. Run `/grasp` first." and **STOP**.

3. If `--full` was passed:
   - Force a fresh domain analysis — proceed to Phase 3 or Phase 4

4. If `--full` was NOT passed:
   - Compare `Project.domainCommit` against `Project.gitCommitHash` — if they match, the domain graph is current
   - If domain graph is current: report "Domain graph is up to date" and **STOP**

5. Proceed to Phase 3 or Phase 4 to derive/update domain knowledge

6. After successful derivation, update `Project.domainCommit` in Neo4j to match `Project.gitCommitHash`:
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) SET p.domainAnalyzedAt = datetime(), p.domainCommit = p.gitCommitHash"
   ```
   If this update fails, report the error and **STOP** — domain graph consistency depends on this write succeeding.

> **Staleness rule:** Domain graph staleness is determined by comparing `Project.gitCommitHash` (the commit when full analysis ran) against `Project.domainCommit` (the commit when domain analysis last ran). If they differ, the domain graph is stale. The `domainGraphStale` flag from `meta.json` is deprecated and no longer used.

### Phase 3: Lightweight Scan (Path 1 — No Existing Graph)

**Set `HAS_CODEBASE_GRAPH=false`** — there is no existing knowledge graph with `:File`/`:Function`/`:Class` nodes, so `implemented_by` edges cannot be produced.

The preprocessing script does NOT produce a domain graph — it produces **raw material** (file tree, entry points, exports/imports) so the domain-analyzer agent can focus on the actual domain analysis instead of spending dozens of tool calls exploring the codebase. Think of it as a cheat sheet: cheap Python preprocessing → expensive LLM gets a clean, small input → better results for less cost.

1. Run the preprocessing script bundled with this skill, passing `$PROJECT_ROOT` from Phase 0:
   ```
   python ./extract-domain-context.py "$PROJECT_ROOT"
   ```
   This outputs `$PROJECT_ROOT/.grasp-it/intermediate/domain-context.json` containing:
   - File tree (respecting `.gitignore`)
   - Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers)
   - File signatures (exports, imports per file)
   - Code snippets for each entry point (signature + first few lines)
   - Project metadata (package.json, README, etc.)
2. Read the generated `domain-context.json` as context for Phase 5
3. Proceed to Phase 5

### Phase 4: Derive from Existing Graph (Path 2 — Has Codebase Graph)

**Set `HAS_CODEBASE_GRAPH=true`** — the existing knowledge graph contains `:File`/`:Function`/`:Class` nodes that `implemented_by` edges can link to.

1. Query Neo4j for the existing knowledge graph:
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN n ORDER BY n.name"
   ```
   If Neo4j query fails, report the error and **STOP**.

2. Format the graph data as structured context:
   - All nodes with their types, names, summaries, and tags
   - All edges with their types (especially `calls`, `imports`, `contains`)
   - All layers with their descriptions
   - Tour steps if available
3. This is the context for the domain analyzer — no file reading needed
4. Proceed to Phase 5

### Phase 5: Domain Analysis

1. Read the domain-analyzer agent prompt from `$PLUGIN_ROOT/agents/domain-analyzer.md`
2. Pass `HAS_CODEBASE_GRAPH` (from Phase 3 or 4) to the agent — this flag controls whether `implemented_by` edges are emitted
3. Dispatch a subagent with the domain-analyzer prompt + the context from Phase 3 or 4
4. The agent writes its output to `$PROJECT_ROOT/.grasp-it/intermediate/domain-analysis.json`

### Phase 6: Validate and Save

1. Read the domain analysis output
2. Validate using the standard graph validation pipeline (the schema now supports domain/feature/operation types)
3. If validation fails, log warnings but save what's valid (error tolerance)
4. **All nodes written to the graph must include `"kind": "knowledge"` and `"source": "code-analysis"`** — this is required by the schema and distinguishes code-mined knowledge from specialist-described knowledge

### Phase 6b: Merge into Domain Graph

The domain graph is stored in Neo4j. When merging new domain analysis results:

#### 6b-1. Load existing domain graph

Query Neo4j for existing domain elements:
```bash
SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (d) WHERE d.kind = 'knowledge' AND d.source = 'code-analysis' RETURN d"
```
If Neo4j query fails, report the error and **STOP**.

Read the new domain analysis output as `incomingNodes` and `incomingEdges`.

#### 6b-2. Classify each incoming node

For each incoming node, compare against all existing nodes by `id`:

- **Same `id`, same `source: "code-analysis"`** — re-run of the same skill on the same topic:
  - Update `summary`, `name`, `tags` with the incoming values
  - If the existing node has `status: "accepted"` or `"implemented"`, keep that status (do not downgrade)
  - Keep all existing edges; append incoming edges that are not already present (deduplicate by `(source, target, type)`)

- **Same `id`, different `source`** (e.g., existing has `source: "interview"`, incoming has `source: "code-analysis"`) — concurrent runs with different perspectives:
  - **Do not overwrite.** Rename the incoming node's `id` by appending a double-dash suffix and the source name: `feature:invoice-assignment` becomes `feature:invoice-assignment--code-analysis`
  - This preserves both perspectives explicitly.

- **New `id`** (no existing node with that id):
  - Append the incoming node as-is

#### 6b-3. Track conflicts for user reporting

Maintain a `conflicts[]` list: for every same-`id`, different-`source` rename, record `{ id, existingSource, incomingSource, existingSummary, incomingSummary }`.

#### 6b-4. Merge edges

Edges: deduplicate by `(source, target, type)` composite. All new edges are appended; existing edges are preserved.

#### 6b-5. Validate and write

1. Validate the merged graph against the schema
2. Write the merged domain graph to Neo4j:
   ```bash
   SKILL_DIR="$PLUGIN_ROOT/skills/grasp-domain"
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   # Write domain elements to Neo4j
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) SET p.domainAnalyzedAt = datetime(), p.domainCommit = p.gitCommitHash"
   ```
   For each domain element, use cypher to `MERGE` (upsert) the node.
   If the Neo4j write fails, report the error and **STOP** — the domain graph must be persisted to Neo4j.
3. Report any conflicts to the user (same format as Phase 5g in grasp-requirements)

### Phase 7: Clean Up

1. Clean up `$PROJECT_ROOT/.grasp-it/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.grasp-it/intermediate/domain-context.json`

### Phase 8: Launch Dashboard

1. Auto-trigger `/grasp-dashboard` to visualize the domain graph
2. The dashboard will query Neo4j for domain elements and show the domain view by default
