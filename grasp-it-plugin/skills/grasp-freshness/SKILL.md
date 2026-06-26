---
name: grasp-freshness
description: Use when you want to know which parts of the knowledge graph may be stale and which domains need re-derivation
allowed-tools: Bash
---

# /grasp-freshness

Produce a per-domain staleness report for the knowledge graph stored in Neo4j.

The skill answers the question: **"Which domains in my knowledge graph may be stale and need re-derivation?"** It runs the same `findStaleImplementedBy` logic that `/grasp` uses for incremental updates, but groups the results by their `Domain` ancestor (with a `sourceFiles` directory fallback) so you can decide where to refresh first.

The skill **does not auto-refresh**. After the report, the user picks which domains to re-derive (via `/grasp-domain`) or whether to do a full rebuild (`/grasp --full`).

## When to use

- Before running `/grasp --full`, to know whether a targeted re-derivation of a few domains would be cheaper.
- After a long stretch of commits, to identify which parts of the graph are most behind.
- After onboarding to a project, to understand the current coverage and freshness state.
- Periodically, as a maintenance check — there is no automatic staleness warning elsewhere.

## Connection

Credentials are loaded automatically by `run-query.mjs` in this priority order:
1. Environment variables (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`)
2. Project `.env` file
3. Global config at `~/.grasp-it/neo4j.env`

`NEO4J_CONNECTION_TYPE` controls the backend: `driver` (default), `cypher-shell`, or `mcp`.

### Runtime prerequisites

- The Neo4j graph must already exist (i.e. `/grasp` has been run at least once). `/grasp-freshness` does not build a graph — it inspects an existing one.
- Java is only needed if `NEO4J_CONNECTION_TYPE=cypher-shell`. Do not check Java proactively when the connection type is `driver`.

## Instructions

### Phase 0: Resolve `PROJECT_ROOT`, `PLUGIN_ROOT`, `GRASP_SKILL_DIR`

Set `PROJECT_ROOT` to the current working directory.

**Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree, redirect to the main repo root — worktrees are ephemeral and any `.grasp-it/` data lives on the main checkout (see issue #133).

```bash
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
  if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      echo "[grasp-freshness] Detected git worktree at $PROJECT_ROOT"
      echo "[grasp-freshness] Redirecting output to main repo root: $MAIN_ROOT"
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi
```

Resolve the plugin root the same way other skills do (Claude plugin cache first, then symlinks, then common clone paths):

```bash
SKILL_REAL=$(realpath ~/.agents/skills/grasp-freshness 2>/dev/null || readlink -f ~/.agents/skills/grasp-freshness 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-freshness 2>/dev/null || readlink -f ~/.copilot/skills/grasp-freshness 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

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
  echo "  - \$HOME/.grasp-it-plugin"
  echo "  - ${SELF_RELATIVE:-<unresolved path>}"
  echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path>}"
  echo "  - \$HOME/.opencode/grasp-it/grasp-it-plugin"
  echo "  - \$HOME/.pi/grasp-it/grasp-it-plugin"
  echo "  - \$HOME/grasp-it/grasp-it-plugin"
  echo "Make sure the plugin is installed correctly."
  exit 1
fi

# Upgrade to newer cache version if one exists.
if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/package.json" ]; then
  PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "0")
  CACHE_VERSION=$(jq -r '.version' "$LATEST_CACHE/package.json" 2>/dev/null || echo "0")
  if [ "$(printf '%s\n' "$CACHE_VERSION" "$PLUGIN_VERSION" | sort -V | tail -1)" = "$CACHE_VERSION" ] \
     && [ "$CACHE_VERSION" != "$PLUGIN_VERSION" ]; then
    echo "[grasp-freshness] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-freshness] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

# `run-query.mjs` and `neo4j-config-loader.mjs` live in the grasp skill.
GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
```

### Phase 1: Get current HEAD commit

Capture the current commit hash so it can be threaded into the staleness query as `$currentCommit`:

```bash
CURRENT_COMMIT=$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null)
if [ -z "$CURRENT_COMMIT" ]; then
  echo "Error: $PROJECT_ROOT is not a git repository (or HEAD cannot be resolved)."
  echo "Cannot compute staleness without a commit hash."
  exit 1
fi
echo "[grasp-freshness] Current HEAD: $CURRENT_COMMIT"
```

### Phase 2: Query stale `IMPLEMENTED_BY` edges

Build the staleness Cypher via the `buildStaleImplementedByCypher()` API in `@grasp-it/core`, then execute it via `run-query.mjs`. The params bag is passed as a third positional argument (the runner accepts JSON).

```bash
# Build the staleness query (Cypher + $currentCommit placeholder).
STALENESS_QUERY=$(node -e "
import('@grasp-it/core').then(m => {
  const { cypher, params } = m.buildStaleImplementedByCypher();
  params.currentCommit = '$CURRENT_COMMIT';
  console.log(JSON.stringify({ cypher, params }));
}).catch(err => { console.error(err.message); process.exit(1); });
")

CYPHER_TEXT=$(echo "$STALENESS_QUERY" | jq -r '.cypher')
CYPHER_PARAMS=$(echo "$STALENESS_QUERY" | jq -c '.params')

# Hand off to run-query.mjs with the params bag as a third argument.
STALE_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$CYPHER_TEXT" "$CYPHER_PARAMS" 2>/dev/null)
RUN_EXIT=$?

# Handle driver fallback (exit 2) — try cypher-shell.
if [ $RUN_EXIT -eq 2 ] && command -v cypher-shell >/dev/null 2>&1; then
  echo "[grasp-freshness] neo4j-driver unavailable — falling back to cypher-shell..."
  set -a; . "$HOME/.grasp-it/neo4j.env" 2>/dev/null || . "$PROJECT_ROOT/.env" 2>/dev/null; set +a
  # cypher-shell needs --param for placeholders. Format mirrors run-query.mjs:
  # strings get single-quoted, embedded single quotes are escaped.
  CURR_PARAM="currentCommit => '$(echo "$CURRENT_COMMIT" | sed "s/'/\\\\'/g")'"
  STALE_RESULT=$(cypher-shell -a "${NEO4J_URI:-bolt://localhost:7687}" \
    -u "${NEO4J_USERNAME:-neo4j}" -p "${NEO4J_PASSWORD:-password}" \
    -d "${NEO4J_DATABASE:-grasp}" --format plain \
    --param "$CURR_PARAM" \
    "$CYPHER_TEXT" 2>/dev/null)
  RUN_EXIT=$?
fi

if [ $RUN_EXIT -ne 0 ]; then
  echo "Error: Failed to query Neo4j. Cannot produce staleness report."
  exit 1
fi

# Stale rows: {nodeId, nodeName, nodeType, sourceFiles, filePath, analyzedAtCommit}
STALE_ROWS=$(echo "$STALE_RESULT" | jq -c '.results // []')
STALE_COUNT=$(echo "$STALE_ROWS" | jq 'length')

if [ "$STALE_COUNT" = "0" ]; then
  echo ""
  echo "── Staleness report ──"
  echo ""
  echo "No stale IMPLEMENTED_BY edges found."
  echo "The knowledge graph's view of implementation is current for HEAD ${CURRENT_COMMIT:0:8}."
  exit 0
fi

echo "[grasp-freshness] Found $STALE_COUNT stale IMPLEMENTED_BY edge(s)."
```

### Phase 3: Resolve Domain for each stale knowledge node

For each stale knowledge node, walk the graph upwards to find its `Domain` ancestor. The graph structure (per `docs/architecture/neo4j-schema.md`):

- `Feature` is reached from `Domain` via `(:Domain)-[:HAS_FEATURE]->(:Feature)`.
- `Operation` is reached from `Feature` via `(:Feature)-[:HAS_OPERATION]->(:Operation)`.
- Other knowledge nodes hang off `Feature` or `Operation` via the schema-defined `GOVERNS` (BusinessRule → Feature/Operation), `DECIDES` (Decision → Feature/BusinessRule), `CONSTRAINED_BY` (Feature/Decision/BR/Concept → Constraint), and `APPLIES_IN` (Constraint/BR/Risk → Concept/Feature/Operation) edges. We enumerate these explicitly so the traversal does not wander into unrelated subgraphs (e.g., codebase `IMPLEMENTED_BY` edges to Files, which are not `Domain` ancestors).

We walk up to 6 hops because some knowledge nodes (Decision, Constraint, Concept) sit 3–4 hops away from their owning `Domain` via `DECIDES` / `CONSTRAINED_BY` / `APPLIES_IN`. The walk is bounded — it never follows codebase-only relationships (`CONTAINS`, `CALLS`, `IMPORTS`, `IMPLEMENTED_BY`, etc.), so it cannot mis-attribute a node to an unrelated Domain.

`OPTIONAL MATCH` keeps nodes with no Domain in the result set (they fall through to Phase 4).

```bash
# Collect unique node IDs from Phase 2.
NODE_IDS=$(echo "$STALE_ROWS" | jq -r '[.[].nodeId] | unique | .[]')

# Build a JSON list literal: ['feature:auth','operation:login',...]
NODE_IDS_LITERAL=$(echo "$STALE_ROWS" | jq -c '[.[].nodeId] | unique')

# Query for Domain ancestors. For each stale node, walk up to 6 hops through
# the schema-defined knowledge-traversal relationship types only. We use a
# typed pattern (not `[*0..6]`) so the traversal cannot follow unrelated
# codebase edges like IMPLEMENTED_BY → File and accidentally bind a File's
# enclosing Domain. The walked types are the canonical "this-node-belongs-to-
# a-Feature-or-Operation" set from docs/architecture/neo4j-schema.md:
#   HAS_FEATURE    (Domain → Feature)
#   HAS_OPERATION  (Feature → Operation)
#   GOVERNS        (BusinessRule → Feature/Operation)
#   DECIDES        (Decision → Feature/BusinessRule)
#   CONSTRAINED_BY (Feature/Decision/BR/Concept → Constraint)
#   APPLIES_IN     (Constraint/BR/Risk → Concept/Feature/Operation)
DOMAIN_QUERY="
UNWIND ${NODE_IDS_LITERAL} AS nodeId
MATCH (k) WHERE k.id = nodeId
OPTIONAL MATCH (k)-[:HAS_FEATURE|HAS_OPERATION|GOVERNS|DECIDES|CONSTRAINED_BY|APPLIES_IN*1..6]-(d:Domain)
WITH nodeId, k, collect(DISTINCT d) AS domains
RETURN nodeId AS nodeId,
       head([dom IN domains WHERE dom IS NOT NULL | dom.id]) AS domainId,
       head([dom IN domains WHERE dom IS NOT NULL | dom.name]) AS domainName
"

DOMAIN_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$DOMAIN_QUERY" 2>/dev/null)
DOMAIN_EXIT=$?

if [ $DOMAIN_EXIT -eq 2 ] && command -v cypher-shell >/dev/null 2>&1; then
  set -a; . "$HOME/.grasp-it/neo4j.env" 2>/dev/null || . "$PROJECT_ROOT/.env" 2>/dev/null; set +a
  DOMAIN_RESULT=$(cypher-shell -a "${NEO4J_URI:-bolt://localhost:7687}" \
    -u "${NEO4J_USERNAME:-neo4j}" -p "${NEO4J_PASSWORD:-password}" \
    -d "${NEO4J_DATABASE:-grasp}" --format plain \
    "$DOMAIN_QUERY" 2>/dev/null)
  DOMAIN_EXIT=$?
fi

if [ $DOMAIN_EXIT -ne 0 ]; then
  echo "Error: Failed to resolve Domain ancestors. Cannot group by domain."
  exit 1
fi

# Save the {nodeId -> domainId} map for use in Phase 5.
echo "$DOMAIN_RESULT" | jq -c '.results // [] | map({ (.nodeId): (.domainId // null) }) | add // {}' > /tmp/grasp-freshness-domain-map.json
```

**Note:** the path-traversal uses a typed relationship set (six schema-defined knowledge-traversal types) with a fixed upper bound of 6 hops. The walk is intentionally narrow — it only follows the schema-defined "this-node-belongs-to-a-Feature-or-Operation" relationships, never codebase-only edges like `IMPLEMENTED_BY` / `CONTAINS` / `CALLS`. This prevents the traversal from wandering into the codebase subgraph and mis-attributing a node to an unrelated `Domain`. The `OPTIONAL MATCH` ensures nodes with no Domain still appear in the output (with `domainId: null`).

### Phase 4: Fallback grouping — `sourceFiles` directory

For nodes with no Domain ancestor, fall back to the top-level directory of the first `sourceFiles` entry. This is a transitional measure — the design intent is that **every knowledge node belongs to exactly one Domain**, but legacy graphs may have unscoped nodes. Surface them prominently so users notice.

```bash
# For each stale node with no Domain, look at sourceFiles and take the top-level
# directory of the first entry (e.g. ['src/auth/login.ts'] → 'src/auth/').
# If sourceFiles is empty or missing, use the filePath of the changed file.
PHASE4_QUERY="
UNWIND ${NODE_IDS_LITERAL} AS nodeId
MATCH (k) WHERE k.id = nodeId
OPTIONAL MATCH (k)-[:IMPLEMENTED_BY]->(f:File)
WITH k, nodeId,
     collect(DISTINCT f.filePath) AS filePaths,
     head(coalesce(k.sourceFiles, [])) AS firstSource
RETURN nodeId AS nodeId,
       filePaths,
       firstSource
"

PHASE4_RESULT=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$PHASE4_QUERY" 2>/dev/null)
PHASE4_EXIT=$?

if [ $PHASE4_EXIT -eq 2 ] && command -v cypher-shell >/dev/null 2>&1; then
  set -a; . "$HOME/.grasp-it/neo4j.env" 2>/dev/null || . "$PROJECT_ROOT/.env" 2>/dev/null; set +a
  PHASE4_RESULT=$(cypher-shell -a "${NEO4J_URI:-bolt://localhost:7687}" \
    -u "${NEO4J_USERNAME:-neo4j}" -p "${NEO4J_PASSWORD:-password}" \
    -d "${NEO4J_DATABASE:-grasp}" --format plain \
    "$PHASE4_QUERY" 2>/dev/null)
  PHASE4_EXIT=$?
fi

if [ $PHASE4_EXIT -ne 0 ]; then
  echo "Error: Failed to compute sourceFiles fallback grouping."
  exit 1
fi

echo "$PHASE4_RESULT" | jq -c '.results // []' > /tmp/grasp-freshness-fallback.json
```

### Phase 5: Group, rank, and merge

Use Node to do the join + sort in one pass. The grouping key for each stale edge is:
- `domain:<domainId>` if the node has a Domain ancestor
- `(no domain, <top-level-dir>/)` otherwise

Rank by `(stale node count DESC, oldest analyzedAtCommit ASC)`:

```bash
node -e '
import("node:fs").then(fs => {
  const rows = '"$STALE_ROWS"';
  const domainMap = JSON.parse(fs.readFileSync("/tmp/grasp-freshness-domain-map.json", "utf-8"));
  const fallback = JSON.parse(fs.readFileSync("/tmp/grasp-freshness-fallback.json", "utf-8"));
  const fbMap = Object.fromEntries(fallback.map(f => [f.nodeId, f]));

  // Join each stale row with its group key.
  const groups = new Map();
  for (const row of rows) {
    const domainId = domainMap[row.nodeId] || null;
    let groupKey, groupLabel;
    if (domainId) {
      groupKey = "domain:" + domainId;
      groupLabel = domainId;
    } else {
      const fb = fbMap[row.nodeId] || {};
      const sf = fb.firstSource || (fb.filePaths && fb.filePaths[0]) || "";
      const topDir = sf.includes("/") ? sf.slice(0, sf.indexOf("/") + 1) : "(root)";
      groupKey = "dir:" + topDir;
      groupLabel = "(" + topDir + ", no Domain)";
    }
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { label: groupLabel, rows: [] });
    }
    groups.get(groupKey).rows.push(row);
  }

  // Rank: stale count DESC, oldest analyzedAtCommit ASC.
  const ranked = [...groups.values()].map(g => {
    const sorted = g.rows.slice().sort((a, b) =>
      (a.analyzedAtCommit || "").localeCompare(b.analyzedAtCommit || "")
    );
    return {
      label: g.label,
      count: g.rows.length,
      files: new Set(g.rows.map(r => r.filePath).filter(Boolean)).size,
      oldest: sorted[0]?.analyzedAtCommit || "?",
      rows: sorted,
    };
  }).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (a.oldest || "").localeCompare(b.oldest || "");
  });

  console.log(JSON.stringify(ranked, null, 2));
}).catch(err => { console.error(err.message); process.exit(1); });
' > /tmp/grasp-freshness-ranked.json
```

### Phase 6: Print the report

Render the ranked groups as a Markdown table. The table has one row per group, sorted most-stale first.

```bash
RANKED=$(cat /tmp/grasp-freshness-ranked.json)

echo ""
echo "── Per-domain staleness report (HEAD ${CURRENT_COMMIT:0:8}) ──"
echo ""
echo "Found $STALE_COUNT stale IMPLEMENTED_BY edge(s) across $(echo "$RANKED" | jq 'length') group(s)."
echo ""
printf "%-50s %10s %10s %-12s\n" "GROUP" "STALE" "FILES" "OLDEST"
printf "%-50s %10s %10s %-12s\n" "-----" "-----" "-----" "------"

echo "$RANKED" | jq -r '.[] | [.label, .count, .files, .oldest[:8]] | @tsv' | \
  while IFS=$'\t' read -r LABEL COUNT FILES OLDEST; do
    printf "%-50s %10s %10s %-12s\n" "$LABEL" "$COUNT" "$FILES" "$OLDEST"
  done

echo ""
echo "── Recommended actions ──"
echo ""
echo "$RANKED" | jq -r '.[] | "  • " + .label + ": re-derive with /grasp-domain for this domain (or /grasp --full if a full rebuild is acceptable)"'
```

### Phase 7: (Optional) Drill into a specific group

If the user asks for more detail on a specific group, list the individual stale rows:

```bash
# Example: print all stale rows in the first group.
jq -r '.[0].rows[] | "  - \(.nodeType):\(.nodeId)  →  \(.filePath)  (analyzed at \(.analyzedAtCommit[:8]))"' /tmp/grasp-freshness-ranked.json
```

### Notes

- **No auto-refresh.** The skill only reports. Run `/grasp-domain <domain-id>` to re-derive a single domain, or `/grasp --full` to rebuild the entire codebase subgraph.
- **Legacy data.** `File` nodes whose `analyzedAtCommit` is `NULL` (pre-Task 21 graphs) are excluded from the report by `buildStaleImplementedByCypher` — they are treated as unanalyzed, not stale. Re-run `/grasp` to populate `analyzedAtCommit` for those files.
- **Group sort tiebreakers.** When two groups have the same stale count, the group with the older `analyzedAtCommit` is listed first (more likely to be further behind).
- **Worktree caveat.** The Neo4j data lives in the main repo's Neo4j connection (not in the worktree), so the redirect in Phase 0 is purely about consistency with other skills.
