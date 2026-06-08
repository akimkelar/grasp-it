---
name: grasp-domain
description: Extract business domain knowledge from a codebase and generate an interactive domain flow graph. Works standalone (lightweight scan) or derives from an existing /grasp knowledge graph.
argument-hint: [--full]
---

# /grasp-domain

Extracts business domain knowledge — domains, features, operations, actors, business rules, and entities — from a codebase and produces an interactive domain flow graph in the dashboard.

## How It Works

- If a knowledge graph already exists (`.grasp-it/knowledge-graph.json`), derives domain knowledge from it (cheap, no file scanning)
- If no knowledge graph exists, performs a lightweight scan: file tree + entry point detection + sampled files
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
```

Use `$PLUGIN_ROOT` for every reference to agent definitions in subsequent phases.

### Phase 1: Git Staleness Check

Before deriving domain knowledge, check whether the underlying knowledge graph is stale relative to the current HEAD:

1. Query Neo4j `Project` singleton for `gitCommitHash` using `load-project-meta.mjs`:
   ```bash
   # Try Neo4j first
   SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
   NEO4J_RESULT=$(node "$SKILL_DIR/../grasp/load-project-meta.mjs" "$PROJECT_ROOT" 2>/dev/null)
   if [ -n "$NEO4J_RESULT" ] && [ "$NEO4J_RESULT" != "{}" ]; then
     LAST_COMMIT=$(echo "$NEO4J_RESULT" | jq -r '.gitCommitHash // empty')
   fi
   # Fallback to meta.json only if Neo4j unavailable or returned empty
   if [ -z "$LAST_COMMIT" ] && [ -f "$PROJECT_ROOT/.grasp-it/meta.json" ]; then
     LAST_COMMIT=$(grep -o '"gitCommitHash"[[:space:]]*:[[:space:]]*"[^"]*"' "$PROJECT_ROOT/.grasp-it/meta.json" | head -1 | sed 's/.*: "\(.*\)"/\1/')
   fi
   ```
2. Compare `LAST_COMMIT` to `git rev-parse HEAD` — if they differ, the graph is stale
3. If stale, print a warning:
   > "Graph may be stale — last analyzed at `<lastCommit>` (`N` commits behind HEAD). Results may not reflect recent code changes. Run `/grasp` to update."
4. **Continue execution regardless** — the warning is advisory only

> **Note:** This check queries Neo4j for the `Project` singleton's `gitCommitHash`, falling back to `meta.json` only if Neo4j is unavailable. To check whether your local graph is in sync with a shared Neo4j database, run `check-sync.mjs` separately.

### Phase 2: Detect Existing Graph and Preflight Staleness

1. Check if a `Project` singleton exists in Neo4j (using `load-project-meta.mjs`)
2. If `--full` was passed:
   - Force a fresh domain analysis — proceed to Phase 3 or Phase 4
3. If `--full` was NOT passed:
   - Query Neo4j for `Project.domainCommit` to check if domain analysis is current
   - Compare `Project.domainCommit` against `Project.gitCommitHash` — if they match, the domain graph is current
   - If domain graph is current: report "Domain graph is up to date" and **STOP**
4. Proceed to Phase 3 or Phase 4 to derive/update domain knowledge
5. After successful derivation, update `Project.domainCommit` in Neo4j to match `Project.gitCommitHash`

> **Note:** The `domainGraphStale` flag from `meta.json` is deprecated. Staleness is now determined by comparing `Project.gitCommitHash` (the commit when full analysis ran) against `Project.domainCommit` (the commit when domain analysis last ran). If they differ, the domain graph is stale.

### Phase 3: Lightweight Scan (Path 1)

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
2. Read the generated `domain-context.json` as context for Phase 4
3. Proceed to Phase 4

### Phase 4: Derive from Existing Graph (Path 2)

1. Query Neo4j for the existing knowledge graph:
   ```bash
   SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN n ORDER BY n.name"
   ```
2. Format the graph data as structured context:
   - All nodes with their types, names, summaries, and tags
   - All edges with their types (especially `calls`, `imports`, `contains`)
   - All layers with their descriptions
   - Tour steps if available
3. This is the context for the domain analyzer — no file reading needed
4. Proceed to Phase 5

> **Fallback:** If Neo4j is unavailable, fall back to reading `$PROJECT_ROOT/.grasp-it/knowledge-graph.json` for backward compatibility.

### Phase 5: Domain Analysis

1. Read the domain-analyzer agent prompt from `$PLUGIN_ROOT/agents/domain-analyzer.md`
2. Dispatch a subagent with the domain-analyzer prompt + the context from Phase 3 or 4
3. The agent writes its output to `$PROJECT_ROOT/.grasp-it/intermediate/domain-analysis.json`

### Phase 6: Validate and Save

1. Read the domain analysis output
2. Validate using the standard graph validation pipeline (the schema now supports domain/feature/operation types)
3. If validation fails, log warnings but save what's valid (error tolerance)
4. **All nodes written to the graph must include `"kind": "knowledge"` and `"source": "code-analysis"`** — this is required by the schema and distinguishes code-mined knowledge from specialist-described knowledge

### Phase 6b: Merge into Domain Graph

The domain graph is stored in Neo4j (primary) with optional backup at `$PROJECT_ROOT/.grasp-it/domain-graph.json`. When merging new domain analysis results:

#### 6b-1. Load existing domain graph

Query Neo4j for existing domain elements:
```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (d:DomainElement)-[:PART_OF]->(p:Project) WHERE p.id = 'project:singleton' RETURN d"
```

If Neo4j is unavailable, fall back to reading `$PROJECT_ROOT/.grasp-it/domain-graph.json`.

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
   SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
   # Write domain elements to Neo4j
   node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) SET p.domainAnalyzedAt = datetime(), p.domainCommit = p.gitCommitHash"
   ```
   For each domain element, use cypher to `MERGE` (upsert) the node and create the `PART_OF` relationship.
3. Optionally write to `$PROJECT_ROOT/.grasp-it/domain-graph.json` as a local backup:
   ```bash
   node -e "
   const fs = require('fs');
   const backup = { nodes: mergedNodes, edges: mergedEdges, updatedAt: new Date().toISOString() };
   fs.writeFileSync('$PROJECT_ROOT/.grasp-it/domain-graph.json', JSON.stringify(backup, null, 2));
   "
   ```
4. Report any conflicts to the user (same format as Phase 5g in grasp-requirements)

### Phase 7: Clean Up

1. Clean up `$PROJECT_ROOT/.grasp-it/intermediate/domain-analysis.json` and `$PROJECT_ROOT/.grasp-it/intermediate/domain-context.json`

### Phase 8: Launch Dashboard

1. Auto-trigger `/grasp-dashboard` to visualize the domain graph
2. The dashboard will detect `domain-graph.json` and show the domain view by default
