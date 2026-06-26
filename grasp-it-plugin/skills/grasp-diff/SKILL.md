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

### Phase 1: Verify Graph Exists

1. Check that a `Project` singleton exists in Neo4j:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p"
   ```
   If Neo4j returns no results, tell the user to run `/grasp` first.

### Phase 1.5: Compute diff base + per-file scope check

This phase does three things, in order: (1) determine the set of changed files
and the set of deleted files, (2) for each changed file, classify the graph's
view of it as fresh / stale / not analyzed / unanalyzed, and (3) print only
the actionable warnings. The phase is advisory — execution continues
regardless of warnings.

The classification answers the right question for `/grasp-diff`: "for each file
in the diff, is the graph's view of that file current?" — not a global
HEAD-vs-stored-commit check that produces false positives on feature branches.

```bash
# ── 1. Compute diff base ──────────────────────────────────────────────────
# CHANGED_FILES is a newline-delimited list of paths in the diff.
# Precedence: caller-provided $GRASP_DIFF_FILES_MOCK (tests) → git diff → empty.
if [ -z "$GRASP_DIFF_FILES_MOCK" ]; then
  CHANGED_FILES=$(git diff main...HEAD --name-only 2>/dev/null \
               || git diff --name-only 2>/dev/null \
               || echo "")
  # Strip trailing newline so [ -n "$CHANGED_FILES" ] below is reliable.
  CHANGED_FILES=$(printf '%s' "$CHANGED_FILES")
else
  CHANGED_FILES="$GRASP_DIFF_FILES_MOCK"
fi

# DELETED_FILES is a separate concern — files that existed in the base branch
# but are removed at HEAD. Phase 2.5 handles the knowledge-node cleanup.
DELETED_FILES=$(git diff --name-only --diff-filter=D main...HEAD 2>/dev/null \
             || git diff --name-only --diff-filter=D HEAD~1..HEAD 2>/dev/null \
             || echo "")

# ── 2. Per-file scope check ───────────────────────────────────────────────
# run-query.mjs does not support parameterized queries, so the path list is
# inlined into the Cypher string. Paths in real checkins cannot contain a
# single quote, so simple escaping via jq is sufficient.
SCOPE_RESULT=""
SCOPE_WARNINGS=""
if [ -n "$CHANGED_FILES" ]; then
  # Read analyzedAtCommit map. When GRASP_DIFF_SCOPE_MOCK is set, the test
  # harness injects a JSON object { "path": "commit" | null } and the live
  # run-query.mjs call is skipped. Production runs leave the variable unset.
  if [ -n "$GRASP_DIFF_SCOPE_MOCK" ]; then
    SCOPE_MAP="$GRASP_DIFF_SCOPE_MOCK"
  else
    # Build the inlined list of single-quoted paths, e.g. ['a.ts','b.ts'].
    PATHS_LITERAL=$(printf '%s\n' "$CHANGED_FILES" \
      | jq -R '.' | jq -s 'map(select(length > 0)) | tostring')
    SCOPE_MAP=$(node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
      "UNWIND ${PATHS_LITERAL} AS path OPTIONAL MATCH (f:File {filePath: path}) RETURN path, f.analyzedAtCommit AS analyzedAtCommit" \
      | jq -c '.results // [] | map({ (."path"): ."analyzedAtCommit" }) | add // {}')
  fi

  echo ""
  echo "── Per-file scope check ──"
  printf '%-50s %-15s %s\n' "FILE" "STATUS" "DETAIL"
  printf '%-50s %-15s %s\n' "----" "------" "------"

  while IFS= read -r path; do
    [ -z "$path" ] && continue
    # `has(p)` distinguishes "key absent" (not_analyzed) from
    # "key present but value null" (unanalyzed). We emit a sentinel via jq
    # to keep the bash-side string comparison simple:
    #   ABSENT  → key missing
    #   NULL    → key present, value null
    #   <hash>  → key present, value is a commit hash
    ANALYZED_AT=$(printf '%s' "$SCOPE_MAP" | jq -r --arg p "$path" '
      if (.[$p] == null) and (has($p) | not) then "ABSENT"
      elif (.[$p] == null) then "NULL"
      else (.[$p] | tostring)
      end
    ')
    PATH_TIP=$(git -C "$PROJECT_ROOT" log -1 --format=%H -- "$path" 2>/dev/null || echo "")

    if [ "$ANALYZED_AT" = "ABSENT" ]; then
      STATUS="not_analyzed"
      DETAIL="File is in the diff but has never been analyzed. Run /grasp to populate the graph."
    elif [ "$ANALYZED_AT" = "NULL" ]; then
      STATUS="unanalyzed"
      DETAIL="File exists in the graph but has no analyzedAtCommit (legacy data); treating as stale."
    elif [ -n "$PATH_TIP" ] && [ "$ANALYZED_AT" != "$PATH_TIP" ]; then
      STATUS="stale"
      # Only flag stale if the analyzed commit is an ancestor of (or simply
      # different from) the current last-modifying commit. We compare hashes
      # directly: a File is stale when its analyzed commit != last-modifying
      # commit, regardless of which is newer. In practice analyzedAtCommit is
      # always the same as or earlier than the last-modifying commit because
      # analysis can only happen against past code.
      IS_ANCESTOR=$(git -C "$PROJECT_ROOT" merge-base --is-ancestor "$ANALYZED_AT" "$PATH_TIP" 2>/dev/null && echo "yes" || echo "no")
      if [ "$IS_ANCESTOR" = "yes" ]; then
        DETAIL="Graph analyzed at ${ANALYZED_AT:0:8}; file last modified at ${PATH_TIP:0:8}. Re-run /grasp to refresh."
      else
        # analyzedAtCommit is ahead of last-modifying commit — happens when
        # the file is later modified but the analysis already covered a
        # newer state via another commit. Treat as fresh.
        STATUS="fresh"
        DETAIL="Analyzed commit (${ANALYZED_AT:0:8}) is at or after last modification (${PATH_TIP:0:8})."
      fi
    else
      STATUS="fresh"
      DETAIL="Analyzed at ${ANALYZED_AT:0:8}; matches last modification."
    fi

    printf '%-50s %-15s %s\n' "$path" "$STATUS" "$DETAIL"

    # Accumulate machine-readable result for downstream phases.
    if [ -z "$SCOPE_RESULT" ]; then
      SCOPE_RESULT="{\"path\":\"$path\",\"status\":\"$STATUS\"}"
    else
      SCOPE_RESULT="$SCOPE_RESULT,{\"path\":\"$path\",\"status\":\"$STATUS\"}"
    fi

    if [ "$STATUS" != "fresh" ]; then
      if [ -z "$SCOPE_WARNINGS" ]; then
        SCOPE_WARNINGS="$path: $STATUS — $DETAIL"
      else
        SCOPE_WARNINGS="$SCOPE_WARNINGS
$path: $STATUS — $DETAIL"
      fi
    fi
  done <<< "$CHANGED_FILES"

  echo ""
  if [ -n "$SCOPE_WARNINGS" ]; then
    echo "── Scope check warnings (advisory — execution continues) ──"
    printf '%s\n' "$SCOPE_WARNINGS"
    echo ""
  fi
  SCOPE_RESULT="[$SCOPE_RESULT]"
fi
export CHANGED_FILES DELETED_FILES SCOPE_RESULT SCOPE_WARNINGS
```

### Phase 2: Use precomputed changed/deleted files

`$CHANGED_FILES` and `$DELETED_FILES` were computed in Phase 1.5. Use them
directly. If `DELETED_FILES` is non-empty, these files must be removed from
the knowledge graph. Proceed to Phase 2.5 to handle deleted files BEFORE
analyzing changes.

### Phase 2.5: Intelligent deletion of knowledge nodes for removed files

For each deleted file, analyze the knowledge graph to determine which nodes should be deleted, revised, or flagged for review. This keeps the graph accurate even when a full rebuild (`/grasp --full`) is not run.

#### Understanding `sourceFiles` vs `IMPLEMENTED_BY`

Before proceeding, understand the two provenance mechanisms in the knowledge graph:

- **`sourceFiles`**: Tracks *provenance* — which files were analyzed to derive this knowledge. A knowledge node with `sourceFiles: ['file:A.ts', 'file:B.ts']` means "this knowledge was extracted from analyzing both A.ts and B.ts." Deleting a file removes one source of evidence, but the knowledge may still be valid if other sources exist.

- **`IMPLEMENTED_BY`**: Tracks *semantic implementation* — which code implements this feature. A knowledge node with `IMPLEMENTED_BY` edges to files means "these files contain the actual code for this feature." If all implementing files are deleted, the knowledge node may no longer have any live evidence and should be reconsidered.

Both are needed for accurate deletion decisions. A node may have `sourceFiles` pointing to a deleted file but still be valid if it has `IMPLEMENTED_BY` edges to surviving files — or vice versa.

#### Step 1: Find affected knowledge nodes via two approaches

For each deleted file path `<relative-path>`, query both:

**Approach A — via `sourceFiles` array:**
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge) WHERE 'file:<relative-path>' IN n.sourceFiles RETURN n.id AS id, n.type AS type, n.name AS name"
```

**Approach B — via `IMPLEMENTED_BY` edge:**
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge)-[:IMPLEMENTED_BY]->(f:File {filePath: '<relative-path>'}) RETURN n.id AS id, n.type AS type, n.name AS name"
```

Combine results from both queries, deduplicating by node ID.

#### Step 2: For each affected node, query edge state

For each knowledge node `<node-id>` found in Step 1, query its connectivity:

**Check IMPLEMENTED_BY edges:**
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge {id: '<node-id>'})-[r:IMPLEMENTED_BY]->(f:File) RETURN f.filePath AS filePath"
```

**Check `sourceFiles` array:**
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge {id: '<node-id>'}) RETURN n.sourceFiles AS sourceFiles"
```

**Check total edge degree (all relationship types):**
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge {id: '<node-id>'}) RETURN size((n)--()) AS totalDegree"
```

#### Step 3: Determine action based on node type and connectivity

Use the queries above to classify each node:

| Node Type | Condition | Action |
|-----------|-----------|--------|
| `domain` | Any | REVIEW — high-level, may span multiple files, connections matter |
| `feature` | All `IMPLEMENTED_BY` targets are deleted files | REVIEW — may span multiple files |
| `operation` | All `IMPLEMENTED_BY` targets are deleted files | REVIEW — may span multiple files |
| `business-rule` | All `IMPLEMENTED_BY` targets are deleted files | REVIEW — often derived from multiple sources |
| `entity` | Only `IMPLEMENTED_BY` edges to deleted file(s), no other edges | DELETE |
| `entity` | Has edges to other surviving files | REVIEW — knowledge may still be valid |
| `risk` | `sourceFiles` only contains deleted file AND no surviving `IMPLEMENTED_BY` | DELETE |
| `constraint` | Only `IMPLEMENTED_BY` edges to deleted file(s), no other edges | DELETE |
| `constraint` | Has edges to other surviving files | REVIEW — may still be valid |

#### Step 4: Execute the determined action

**DELETE action:**
```bash
# Remove from layer nodeIds arrays first
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (l) WHERE l.nodeIds IS NOT NULL AND '<node-id>' IN l.nodeIds SET l.nodeIds = [x IN l.nodeIds WHERE x <> '<node-id>']"

# Then delete the node
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge {id: '<node-id>'}) DETACH DELETE n"
```

**REVIEW action — flag for human review:**
Report the node as needing manual review. Include:
- Node id, type, name
- Which deleted file triggered this
- Current `IMPLEMENTED_BY` targets (list deleted vs surviving)
- Current `sourceFiles` array
- Total edge degree

**REVISE action — update `sourceFiles`:**
```bash
# Remove deleted file from sourceFiles array
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n:Knowledge {id: '<node-id>'}) SET n.sourceFiles = [f IN n.sourceFiles WHERE f <> 'file:<relative-path>']"
```

#### Step 5: Also delete the file node and its derived nodes

The knowledge-node cleanup above handles `Knowledge` nodes. Now clean up file-derived nodes:

```bash
# Delete file node directly
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n {id: 'file:<relative-path>'}) DETACH DELETE n"

# Delete all nodes with matching filePath (functions, classes defined in the file)
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (n) WHERE n.filePath = '<relative-path>' DETACH DELETE n"

# Remove deleted file node IDs from layer nodeIds arrays
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
  "MATCH (l) WHERE l.nodeIds IS NOT NULL AND 'file:<relative-path>' IN l.nodeIds SET l.nodeIds = [x IN l.nodeIds WHERE x <> 'file:<relative-path>']"
```

#### Example scenarios

**Scenario A — Domain node with many connections, file deleted:**
```cypher
# Find domain nodes affected by a deleted file
MATCH (n:Knowledge {type: 'domain'})-[r:IMPLEMENTED_BY]->(f:File {filePath: 'services/AuthService.ts'})
RETURN n.id, n.name, size((n)--()) AS totalDegree

# Result: totalDegree=15 → REVIEW (high connectivity means it's a central concept)
```

**Scenario B — Entity node with only one IMPLEMENTED_BY to deleted file:**
```cypher
# Check if ALL IMPLEMENTED_BY targets are deleted files
MATCH (n:Knowledge {id: 'entity:UserProfile'})-[r:IMPLEMENTED_BY]->(f:File)
RETURN f.filePath, 'services/AuthService.ts' = f.filePath AS isDeleted

# All return true → DELETE
```

**Scenario C — Risk node with sourceFiles only containing deleted file:**
```cypher
# Check sourceFiles only
MATCH (n:Knowledge {id: 'risk:data-breach'})
RETURN n.sourceFiles

# Result: ['file:services/AuthService.ts'] → DELETE (no surviving evidence)

# vs a risk with multiple sources:
MATCH (n:Knowledge {id: 'risk:sql-injection'})
RETURN n.sourceFiles

# Result: ['file:services/AuthService.ts', 'file:db/queries.ts'] → REVIEW
# (AuthService deleted but queries.ts still exists)
```

**Scenario D — Feature node with mixed IMPLEMENTED_BY targets:**
```cypher
# Check all IMPLEMENTED_BY targets
MATCH (n:Knowledge {id: 'feature:login'})-[r:IMPLEMENTED_BY]->(f:File)
RETURN f.filePath

# Results: ['services/AuthService.ts', 'services/TokenService.ts']
# AuthService deleted, TokenService still exists → REVIEW (feature still partially implemented)
```

**Note:** This intelligent cleanup replaces the simple delete commands. Running `/grasp-diff` on a branch with deleted files will accurately remove stale knowledge nodes while preserving valid cross-file knowledge, preventing both orphaned entries and accidental deletion of important domain concepts.

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
