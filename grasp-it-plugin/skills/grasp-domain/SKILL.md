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

if [ -z "$PLUGIN_ROOT" ]; then
  echo "Error: Cannot find the grasp-it plugin root."
  echo "Checked:"
  echo "  - ${LATEST_CACHE:-<no Claude cache found>}"
  echo "  - $HOME/.grasp-it-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/grasp-domain>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/grasp-domain>}"
  echo "  - $HOME/.opencode/grasp-it/grasp-it-plugin"
  echo "  - $HOME/.pi/grasp-it/grasp-it-plugin"
  echo "  - $HOME/grasp-it/grasp-it-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi

# Upgrade to newer cache version if one exists and is newer than resolved PLUGIN_ROOT.
if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/package.json" ]; then
  PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "0")
  CACHE_VERSION=$(jq -r '.version' "$LATEST_CACHE/package.json" 2>/dev/null || echo "0")
  if [ "$(printf '%s\n' "$CACHE_VERSION" "$PLUGIN_VERSION" | sort -V | tail -1)" = "$CACHE_VERSION" ] \
     && [ "$CACHE_VERSION" != "$PLUGIN_VERSION" ]; then
    echo "[grasp-domain] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-domain] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"
# Print which Neo4j database will be used — surfaces misconfiguration immediately.
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
NEO4J_DB=$(node -e "import('$GRASP_SKILL_DIR/neo4j-config-loader.mjs').then(m=>{const c=m.getNeo4jConfig('$PROJECT_ROOT');console.log(c&&c.NEO4J_DATABASE?c.NEO4J_DATABASE:'grasp');}).catch(()=>{console.log('grasp');})" 2>/dev/null)
echo "[grasp-domain] Using Neo4j database: ${NEO4J_DB:-grasp}"

# Validate that the resolved PLUGIN_ROOT has all required skill files.
# run-query.mjs and neo4j-config-loader.mjs live in the grasp skill as the canonical source.
if [ ! -f "$PLUGIN_ROOT/skills/grasp/run-query.mjs" ]; then
  if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/skills/grasp/run-query.mjs" ]; then
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

### Phase 1: Neo4j Reachability and Graph State Check

Before deriving domain knowledge, check whether Neo4j is reachable and what graph state exists:

1. Query Neo4j `Project` singleton for `gitCommitHash` using `run-query.mjs`:
   ```bash
   GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   NEO4J_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash" 2>/dev/null)
   EXIT_CODE=$?

   # Exit code 2 means driver was unavailable — fall back to cypher-shell
   if [ $EXIT_CODE -eq 2 ]; then
     echo "[grasp-domain] neo4j-driver unavailable — falling back to cypher-shell..."
     if command -v cypher-shell >/dev/null 2>&1; then
       NEO4J_URI="${NEO4J_URI:-neo4j://localhost:7687}"
       NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
       NEO4J_PASSWORD="${NEO4J_PASSWORD:-password}"
       NEO4J_DATABASE="${NEO4J_DATABASE:-grasp}"
       URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
       URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
       [ -z "$URI_HOST" ] && URI_HOST="localhost"
       [ -z "$URI_PORT" ] && URI_PORT="7687"
       NEO4J_RESULT=$(cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format json "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash" 2>/dev/null)
       EXIT_CODE=$?
     else
       echo "Error: neo4j-driver is unavailable and cypher-shell is not installed."
       echo "Cannot proceed. Install neo4j-driver or cypher-shell."
       exit 1
     fi
   fi

   # Any other non-zero exit code means Neo4j is unreachable
   if [ $EXIT_CODE -ne 0 ]; then
     echo "Error: Failed to query Neo4j for project metadata. Cannot proceed without Neo4j."
     echo "Ensure Neo4j is running and accessible, then re-run /grasp-domain."
     exit 1
   fi

   # Empty result means no Project singleton — /grasp has never run
   if [ -z "$NEO4J_RESULT" ] || echo "$NEO4J_RESULT" | grep -q "null\|empty\|\[\]"; then
     echo "[grasp-domain] No existing knowledge graph found in Neo4j."
     echo "[grasp-domain] Will run in standalone mode — IMPLEMENTED_BY edges will not be produced."
     echo "[grasp-domain] Run /grasp first for full codebase connectivity."
     HAS_CODEBASE_GRAPH="false"
     LAST_COMMIT=""
   else
     LAST_COMMIT=$(echo "$NEO4J_RESULT" | jq -r '.gitCommitHash // empty' 2>/dev/null)
     if [ -z "$LAST_COMMIT" ] || [ "$LAST_COMMIT" = "null" ]; then
       echo "[grasp-domain] No existing knowledge graph found (no gitCommitHash)."
       echo "[grasp-domain] Will run in standalone mode — IMPLEMENTED_BY edges will not be produced."
       echo "[grasp-domain] Run /grasp first for full codebase connectivity."
       HAS_CODEBASE_GRAPH="false"
       LAST_COMMIT=""
     else
       HAS_CODEBASE_GRAPH="true"
     fi
   fi
   ```
2. If `HAS_CODEBASE_GRAPH="true"`, compare `LAST_COMMIT` to `git rev-parse HEAD` — if they differ, the graph is stale
3. If stale, print a warning:
   > "Graph may be stale — last analyzed at `<lastCommit>` (`N` commits behind HEAD). Results may not reflect recent code changes. Run `/grasp` to update."
4. **Continue execution regardless** — the warning is advisory only

> **Three-way decision logic:**
> - Neo4j connection error → **STOP** (cannot proceed)
> - Neo4j reachable but no `Project` singleton → **continue to Phase 2 standalone mode** (HAS_CODEBASE_GRAPH=false)
> - Neo4j has `Project.gitCommitHash` → **continue to Phase 2** (HAS_CODEBASE_GRAPH=true, check staleness)

5. **Apply Neo4j schema if needed:** Before any writes to Neo4j, ensure the schema constraints and indexes are in place. This prevents `MERGE` operations and unique-constraint-dependent queries from failing.
   ```bash
   GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   # Detect already-applied schema: query for one well-known constraint (project_id)
   SCHEMA_CHECK=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "SHOW CONSTRAINTS" 2>/dev/null)
   SCHEMA_EXIT=$?
   # If driver exited with 2, use cypher-shell for schema check too
   if [ $SCHEMA_EXIT -eq 2 ]; then
     if command -v cypher-shell >/dev/null 2>&1; then
       NEO4J_URI="${NEO4J_URI:-neo4j://localhost:7687}"
       NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
       NEO4J_PASSWORD="${NEO4J_PASSWORD:-password}"
       NEO4J_DATABASE="${NEO4J_DATABASE:-grasp}"
       URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
       URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
       [ -z "$URI_HOST" ] && URI_HOST="localhost"
       [ -z "$URI_PORT" ] && URI_PORT="7687"
       SCHEMA_CHECK=$(cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format plain "SHOW CONSTRAINTS YIELD name WHERE name = 'project_id' RETURN name AS name" 2>/dev/null)
     fi
   fi
   if echo "$SCHEMA_CHECK" | grep -q "project_id"; then
     echo "[grasp-domain] Neo4j schema already applied."
   else
     echo "[grasp-domain] Applying Neo4j schema (first-use setup)..."
     # Apply schema via cypher-shell if available, otherwise via driver
     if command -v cypher-shell >/dev/null 2>&1; then
       if [ -f "$GRASP_SKILL_DIR/neo4j-config-loader.mjs" ]; then
         . <(node -e "import('$GRASP_SKILL_DIR/neo4j-config-loader.mjs').then(m=>{const c=m.getNeo4jConfig('$PROJECT_ROOT');console.log('NEO4J_URI='+c.NEO4J_URI);console.log('NEO4J_USERNAME='+c.NEO4J_USERNAME);console.log('NEO4J_PASSWORD='+c.NEO4J_PASSWORD);})" 2>/dev/null)2>/dev/null || true
       fi
       cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" --format plain -f "$GRASP_SKILL_DIR/setup-neo4j-schema.cypher" 2>/dev/null && \
         echo "[grasp-domain] Neo4j schema applied successfully." || \
         echo "[grasp-domain] Warning: schema setup failed via cypher-shell"
     else
       # Driver path: apply schema line by line via run-query.mjs
       while IFS= read -r line && [ -n "$line" ]; do
         [ "${line:0:1}" = "/" ] && continue  # skip Cypher comments
         node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$line" 2>/dev/null || true
       done < "$GRASP_SKILL_DIR/setup-neo4j-schema.cypher"
       echo "[grasp-domain] Neo4j schema applied via driver."
     fi
   fi
   ```

### Phase 2: Detect Existing Graph and Preflight Staleness

**`HAS_CODEBASE_GRAPH` is already set in Phase 1.** Use it directly — do not re-check via `load-project-meta.mjs`.

The skill has two paths:
- **Path A (HAS_CODEBASE_GRAPH="true"):** Derive domain knowledge from the existing knowledge graph. `IMPLEMENTED_BY` edges can be produced.
- **Path B (HAS_CODEBASE_GRAPH="false"):** Perform a lightweight standalone scan. No `IMPLEMENTED_BY` edges will be produced because `:File`/`:Function`/`:Class` nodes do not exist.

**Path B — Standalone mode enforcement:**
If `HAS_CODEBASE_GRAPH="false"` and `--standalone` was **not** passed, block with a prominent error:

```bash
if [ "$HAS_CODEBASE_GRAPH" = "false" ] && [ "${FORCE_STANDALONE:-0}" != "1" ]; then
  if echo "$ARGUMENTS" | grep -qv "\-\-standalone"; then
    echo ""
    echo "=============================================="
    echo "ERROR: No codebase graph found in Neo4j."
    echo "       /grasp-domain requires /grasp to run first."
    echo ""
    echo "       Please run: /grasp"
    echo "       Then re-run: /grasp-domain [your args]"
    echo ""
    echo "       Without /grasp, no File/Function/Class nodes exist"
    echo "       and the domain graph cannot be linked to implementation."
    echo ""
    echo "       To proceed without codebase connectivity (domain-only mode),"
    echo "       pass --standalone explicitly."
    echo "=============================================="
    exit 1
  fi
fi
```

**Path A — Staleness check for existing graph:**

1. Query Neo4j for the `Project` singleton's `domainCommit`:
   ```bash
   GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   DOMAIN_COMMIT_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.domainCommit AS domainCommit" 2>/dev/null)
   DOMAIN_COMMIT_EXIT=$?

   # Handle exit code 2 (driver unavailable — fall back to cypher-shell)
   if [ $DOMAIN_COMMIT_EXIT -eq 2 ]; then
     echo "[grasp-domain] neo4j-driver unavailable — falling back to cypher-shell..."
     if command -v cypher-shell >/dev/null 2>&1; then
       NEO4J_URI="${NEO4J_URI:-neo4j://localhost:7687}"
       NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
       NEO4J_PASSWORD="${NEO4J_PASSWORD:-password}"
       NEO4J_DATABASE="${NEO4J_DATABASE:-grasp}"
       URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
       URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
       [ -z "$URI_HOST" ] && URI_HOST="localhost"
       [ -z "$URI_PORT" ] && URI_PORT="7687"
       DOMAIN_COMMIT_RESULT=$(cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format json "MATCH (p:Project {id: 'project:singleton'}) RETURN p.domainCommit AS domainCommit" 2>/dev/null)
     fi
   fi

   if [ $? -ne 0 ]; then
     echo "Error: Failed to query Neo4j for domainCommit."
     exit 1
   fi
   ```
2. If `--full` was passed:
   - Force a fresh domain analysis — proceed to Phase 4
3. If `--full` was NOT passed:
   - Parse `domainCommit` from the result
   - Compare `domainCommit` against `Project.gitCommitHash` (already in `LAST_COMMIT` from Phase 1) — if they match, the domain graph is current
   - If domain graph is current: report "Domain graph is up to date" and **STOP**
4. Proceed to Phase 4 to derive/update domain knowledge

5. After successful derivation, update `Project.domainCommit` in Neo4j to match `Project.gitCommitHash`:
   ```bash
   GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
   DOMAIN_UPDATE_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) SET p.domainAnalyzedAt = datetime(), p.domainCommit = p.gitCommitHash" 2>/dev/null)
   DOMAIN_UPDATE_EXIT=$?

   # Handle exit code 2 (driver unavailable — fall back to cypher-shell)
   if [ $DOMAIN_UPDATE_EXIT -eq 2 ]; then
     if command -v cypher-shell >/dev/null 2>&1; then
       NEO4J_URI="${NEO4J_URI:-neo4j://localhost:7687}"
       NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
       NEO4J_PASSWORD="${NEO4J_PASSWORD:-password}"
       NEO4J_DATABASE="${NEO4J_DATABASE:-grasp}"
       URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
       URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
       [ -z "$URI_HOST" ] && URI_HOST="localhost"
       [ -z "$URI_PORT" ] && URI_PORT="7687"
       cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format plain "MATCH (p:Project {id: 'project:singleton'}) SET p.domainAnalyzedAt = datetime(), p.domainCommit = p.gitCommitHash" 2>/dev/null && DOMAIN_UPDATE_EXIT=0 || DOMAIN_UPDATE_EXIT=1
     fi
   fi

   if [ $DOMAIN_UPDATE_EXIT -ne 0 ]; then
     echo "Error: Failed to update Project.domainCommit in Neo4j."
     echo "Domain graph consistency depends on this write succeeding."
     exit 1
   fi
   ```

> **Staleness rule:** Domain graph staleness is determined by comparing `Project.gitCommitHash` (the commit when full analysis ran) against `Project.domainCommit` (the commit when domain analysis last ran). If they differ, the domain graph is stale. The `domainGraphStale` flag from `meta.json` is deprecated and no longer used.

### Phase 3: Lightweight Scan (Path B — HAS_CODEBASE_GRAPH=false)

**`HAS_CODEBASE_GRAPH="false"` from Phase 1.** No `:File`/`:Function`/`:Class` nodes exist, so `implemented_by` edges cannot be produced.

The preprocessing script does NOT produce a domain graph — it produces **raw material** (file tree, entry points, exports/imports) so the domain-analyzer agent can focus on the actual domain analysis instead of spending dozens of tool calls exploring the codebase. Think of it as a cheat sheet: cheap Python preprocessing → expensive LLM gets a clean, small input → better results for less cost.

1. Parse `--files` from `$ARGUMENTS` and forward to the preprocessing script:
   ```bash
   # Parse --files from ARGUMENTS if present
   SCOPED_FILES_ARG=""
   if echo "$ARGUMENTS" | grep -qE "\-\-files[= ]"; then
     SCOPED_FILES=$(echo "$ARGUMENTS" | sed -E 's/.*--files[= ]([^ ]+).*/\1/')
     if [ -n "$SCOPED_FILES" ]; then
       SCOPED_FILES_ARG="--files $SCOPED_FILES"
       echo "[grasp-domain] Scoping analysis to files: $SCOPED_FILES"
     fi
   fi
   ```
2. Run the preprocessing script bundled with this skill, passing `$PROJECT_ROOT` and the optional `--files` scope:
   ```
   python ./extract-domain-context.py "$PROJECT_ROOT" $SCOPED_FILES_ARG
   ```
   This outputs `$PROJECT_ROOT/.grasp-it/intermediate/domain-context.json` containing:
   - File tree (respecting `.gitignore`)
   - Detected entry points (HTTP routes, CLI commands, event handlers, cron jobs, exported handlers)
   - File signatures (exports, imports per file)
   - Code snippets for each entry point (signature + first few lines)
   - Project metadata (package.json, README, etc.)
2. Read the generated `domain-context.json` as context for Phase 5
3. Proceed to Phase 5

### Phase 4: Derive from Existing Graph (Path A — HAS_CODEBASE_GRAPH=true)

**`HAS_CODEBASE_GRAPH="true"` from Phase 1.** The existing knowledge graph contains `:File`/`:Function`/`:Class` nodes that `implemented_by` edges can link to.

1. Query Neo4j for the existing knowledge graph (scoped to `--files` if provided):
   ```bash
   GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"

   # Parse --files from ARGUMENTS for Phase 4 scope filtering
   SCOPED_FILES_ARG=""
   if echo "$ARGUMENTS" | grep -qE "\-\-files[= ]"; then
     SCOPED_FILES=$(echo "$ARGUMENTS" | sed -E 's/.*--files[= ]([^ ]+).*/\1/')
     if [ -n "$SCOPED_FILES" ]; then
       SCOPED_FILES_ARG="$SCOPED_FILES"
       echo "[grasp-domain] Scoping Phase 4 graph query to files: $SCOPED_FILES"
     fi
   fi

   # Build scoped or unscoped query
   if [ -n "$SCOPED_FILES_ARG" ]; then
     # Build JSON array for Cypher: convert "a,b,c" to '["a","b","c"]'
     SCOPED_FILES_JSON="[$(echo "$SCOPED_FILES_ARG" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')]"
     CYPHER_QUERY="MATCH (n) WHERE any(f IN $SCOPED_FILES_JSON WHERE n.filePath CONTAINS f) OR n.kind = 'knowledge' RETURN n ORDER BY n.name"
   else
     CYPHER_QUERY="MATCH (n) RETURN n ORDER BY n.name"
   fi

   GRAPH_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$CYPHER_QUERY" 2>/dev/null)
   GRAPH_EXIT=$?

   # Handle exit code 2 (driver unavailable — fall back to cypher-shell)
   if [ $GRAPH_EXIT -eq 2 ]; then
     echo "[grasp-domain] neo4j-driver unavailable — falling back to cypher-shell..."
     if command -v cypher-shell >/dev/null 2>&1; then
       NEO4J_URI="${NEO4J_URI:-neo4j://localhost:7687}"
       NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
       NEO4J_PASSWORD="${NEO4J_PASSWORD:-password}"
       NEO4J_DATABASE="${NEO4J_DATABASE:-grasp}"
       URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
       URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
       [ -z "$URI_HOST" ] && URI_HOST="localhost"
       [ -z "$URI_PORT" ] && URI_PORT="7687"
       if [ -n "$SCOPED_FILES_ARG" ]; then
         GRAPH_RESULT=$(cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format json "$CYPHER_QUERY" 2>/dev/null)
       else
         GRAPH_RESULT=$(cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format json "MATCH (n) RETURN n ORDER BY n.name" 2>/dev/null)
       fi
       GRAPH_EXIT=$?
     fi
   fi

   if [ $GRAPH_EXIT -ne 0 ]; then
     echo "Error: Failed to query Neo4j for existing knowledge graph."
     exit 1
   fi
   ```
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

### Phase 6b: Push to Neo4j

**Call the dedicated push script — do NOT write MERGE queries manually.** The script handles the dual-label pattern (`Knowledge` + specific label), correct UPPER_SNAKE_CASE relationship types, and `NEO4J_DATABASE` from the project `.env`. It automatically falls back to cypher-shell if the neo4j-driver is unavailable.

```bash
node "$PLUGIN_ROOT/skills/grasp-domain/push-domain-graph.mjs" "$PROJECT_ROOT"
PUSH_EXIT=$?

# Handle exit code 2 — driver unavailable, but script should have already retried via cypher-shell
if [ $PUSH_EXIT -eq 2 ]; then
  echo "[grasp-domain] push-domain-graph.mjs exited with code 2 (driver unavailable)."
  echo "[grasp-domain] The script should have retried via cypher-shell automatically."
  echo "[grasp-domain] If you see this message, the cypher-shell fallback also failed."
  exit 1
fi

if [ $PUSH_EXIT -ne 0 ]; then
  echo "Error: Failed to push domain graph to Neo4j (exit code: $PUSH_EXIT)."
  exit 1
fi
```

The script at `push-domain-graph.mjs` reads `domain-analysis.json` from `.grasp-it/intermediate/` and writes all nodes and edges to Neo4j in a single operation. It will report any nodes that ended up with no secondary label (orphan check) and exit with code 1 if the write fails.

### Phase 7: Clean Up

1. Clean up `$PROJECT_ROOT/.grasp-it/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.grasp-it/intermediate/domain-context.json`

### Phase 8: Visualization

The domain graph is now in Neo4j. To explore it visually:
- Open Neo4j Browser at http://localhost:7474 (or your Aura console URL)
- Run: `MATCH (n:Knowledge) RETURN n LIMIT 100`
- Or for a domain-specific view: `MATCH (n:Domain) RETURN n`

To query the domain graph via Claude Code:
- `/grasp-search <your question>`

To check the domain graph was persisted correctly:
- `/grasp-search "what domains were extracted from the codebase"`
