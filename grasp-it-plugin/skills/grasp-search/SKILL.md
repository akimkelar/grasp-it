---
name: grasp-search
description: Query the Neo4j knowledge graph to get context, constraints, and code references before reading code. Use at the start of new tasks and before implementing modifications to avoid costly full-codebase searches.
allowed-tools: Bash
---

# Graph Context Search Skill

**Always query the knowledge graph before reading code.** The graph is the first and cheapest source of business context. Use it to understand the domain, rules, constraints, and relevant file scope - so that subsequent code reading is targeted, not exploratory.

Only fall back to code reading after the graph has narrowed the scope, or when the graph does not contain the needed detail.

## When to use

- Starting a new task: query first to understand the domain, operations involved, and hidden constraints - before opening any files
- Before implementing a modification: surface risks, constraints, and impacted code files from the graph first
- Refining a task: check what an operation does and what guards it without reading the implementation
- Whenever a code search would be expensive or the scope is unclear - the graph answer is faster and cheaper

## Connection

Credentials are loaded automatically by `run-query.mjs` in this priority order:
1. Environment variables (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`)
2. Project `.env` file
3. Global config at `~/.grasp-it/neo4j.env`

`NEO4J_CONNECTION_TYPE` controls the backend: `driver` (default), `cypher-shell`, or `mcp`. Use `run-query.mjs` — it reads this setting and routes accordingly without any manual Java check.

### Runtime prerequisites

- In this repository environment, live Neo4j access commonly needs network approval even when credentials are present locally.
- Request escalation proactively before the first live graph query so the skill does not fail partway through.
- If you still start sandboxed and hit connection or permission errors, rerun the same command with the required permissions instead of abandoning the skill.
- Java is only needed if `NEO4J_CONNECTION_TYPE=cypher-shell` or if `run-query.mjs` exits with code 2 (driver unavailable). Do not check Java proactively when the connection type is `driver`.

### Phase 0: Graph Freshness Check

Before querying the graph, check whether it is stale relative to the current HEAD:

1. Query Neo4j `Project` singleton for `gitCommitHash` using `run-query.mjs`:
   ```bash
   SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
   NEO4J_RESULT=$(node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash" 2>/dev/null)
   if [ -z "$NEO4J_RESULT" ] || echo "$NEO4J_RESULT" | grep -q "null\|empty"; then
     echo "Error: Failed to query Neo4j for project metadata. Cannot proceed without Neo4j."
     echo "Ensure Neo4j is running and accessible, then re-run /grasp-search."
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

### Quick health check

Run this before broader graph exploration when using the skill in a fresh environment:

```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN labels(n)[0] AS label LIMIT 3"
QUERY_EXIT=$?

if [ $QUERY_EXIT -eq 2 ]; then
  # run-query.mjs signaled cypher-shell fallback (driver unavailable)
  # Only now check Java — it is only needed for cypher-shell
  java -version
  set -a; source ~/.grasp-it/neo4j.env 2>/dev/null || source .env 2>/dev/null; set +a
  cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" \
    "MATCH (n) RETURN labels(n)[0] AS label LIMIT 3;"
fi
```

If this fails:
- permission or connection-denied style failures: rerun with the required network approval / permissions
- auth or database errors: verify `~/.grasp-it/neo4j.env` values (or project `.env`)
- exit code 2 + cypher-shell missing: install `cypher-shell` or switch `NEO4J_CONNECTION_TYPE` back to `driver`
- empty or irrelevant results: continue with the search approaches below using broader terms or domain scoping

Basic query execution:

```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN n.name LIMIT 5"
```

For multi-line queries, pass a single-line query or use a temporary `.cypher` file with `cypher-shell -f`.

## Graph overview

The simplified Neo4j schema uses two label groups:

**Codebase nodes** (structure and implementation):

| Type | Purpose | `kind` value |
|---|---|---|
| `File` | Source file or module | `File` |
| `Function` | Function or method | `Function` |
| `Class` | Class or struct | `Class` |
| `Module` | Module or package | `Module` |
| `Concept` | Code-level concept | `Concept` |
| `Config` | Configuration entity | `Config` |
| `Service` | Service component | `Service` |
| `Table` | Database table | `Table` |
| `Endpoint` | API endpoint | `Endpoint` |
| `Pipeline` | Data or build pipeline | `Pipeline` |
| `Schema` | Schema definition | `Schema` |
| `Resource` | External resource | `Resource` |

**Knowledge nodes** (business and domain):

| Type | Purpose | `kind` value |
|---|---|---|
| `Domain` | Business domain | `Domain` |
| `Feature` | Workflow or process | `Feature` |
| `Operation` | Workflow step | `Operation` |
| `Actor` | Person or role that performs operations | `Actor` |
| `BusinessRule` | Business rule or policy | `BusinessRule` |
| `Article` | Documentation or article | `Article` |
| `Entity` | Domain entity | `Entity` |
| `Topic` | Topic or subject | `Topic` |
| `Claim` | Assertion or claim | `Claim` |
| `Source` | Source of information | `Source` |
| `Decision` | Decision record | `Decision` |
| `Constraint` | Constraint or rule | `Constraint` |

**Key relationships**:

```
Domain -[:HAS_FEATURE]-> Feature
Feature -[:HAS_OPERATION]-> Operation
Operation -[:PERFORMED_BY]-> Actor
Feature -[:GOVERNED_BY]-> BusinessRule
Feature -[:IMPLEMENTED_BY]-> Code
Entity -[:RELATED_TO]-> Entity
Concept -[:DEFINED_IN]-> File
Function -[:PART_OF]-> Class
Service -[:CALLS]-> Service
Endpoint -[:CALLS]-> Service
File -[:DEFINES]-> Function
File -[:DEFINES]-> Class
```

**Searchable text fields per node**:
- All nodes: `name`, `summary`, `key`
- `kind` property for filtering by node category
- Domain/Feature/Operation: `description`, `featureType`
- Entity: `entityType`, `description`
- Constraint: `constraintType`, `rule`

---

## Decision flow

```
New task received:
  -> Connection health check if environment is fresh or untrusted
      -> exit code 2? -> fall back to cypher-shell (Java needed only here)
      -> permission/network issue? -> rerun query with escalation
  -> Approach 1 (broad text search, direct terms, core fields)
      -> poor results? -> retry with synonyms or shorter terms + more fields
      -> too many scattered results? -> Approach 3 (kind-scoped) -> repeat
  -> Approach 2 (branch query on top entities)
      -> reveals hidden constraints not reachable by text
  -> [optional] Approach 4 (dependency disclosure) if deeper investigation needed

Before/during modification:
  -> Approach 5 (constraint fast-path for named operations)
  -> Approach 6 (file-based reverse lookup if files are already known)
  -> [optional] Point lookup for specific nodes by key if clarification needed

Clarify individual nodes (optional, when a node name is known):
  MATCH (n) WHERE n.name = '...' RETURN n;
```

---

## Term search strategy

**Precision-first**: start with fewer fields and longer/specific terms. `name` and `summary` are the most semantically dense - written to be found. Extend only on poor results.

| Round | Fields searched | Terms |
|---|---|---|
| 1 | `name`, `summary` | Natural language phrases from the task |
| 2 | + `key`, `description` | Add synonyms or shorter phrases |
| 3 | + `constraintType`, `entityType`, `flowType` | Single-word fallback terms |

`kind` property filtering: add `WHERE seed.kind IN [...]` to narrow to specific node categories.

---

## Approach 1 - Broad text search (discovery)

**Use when**: starting investigation, scope is unknown, need to see what the graph knows about the topic.

Searches all node types across core text fields. Scores seeds by number of term hits. Expands 1-hop to neighbor nodes.

```cypher
WITH [
  'working period',
  'period update',
  'period edit'
] AS terms
MATCH (seed)
WHERE any(t IN terms WHERE
    toLower(seed.name) CONTAINS t
    OR toLower(seed.summary) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed
RETURN labels(seed)[0] AS type,
       seed.kind AS kind,
       seed.name AS name,
       score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.name]) AS neighbors
ORDER BY relevance DESC, type, name
LIMIT 50;
```

**On poor results** - extend to more fields with `kind` filtering:

```cypher
WITH ['working period', 'period', 'update'] AS terms
MATCH (seed)
WHERE seed.kind IN ['Domain', 'Feature', 'Entity', 'Operation', 'Concept', 'Constraint']
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.key) CONTAINS t
      OR toLower(coalesce(seed.description, '')) CONTAINS t
      OR toLower(coalesce(seed.constraintType, '')) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.key) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed
RETURN labels(seed)[0] AS type,
       seed.kind AS kind,
       seed.name AS name,
       score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.name]) AS neighbors
ORDER BY relevance DESC, type, name
LIMIT 50;
```

**Read results as**: scored seed nodes + flat neighbor lists. Tells you what exists in the graph and how nodes connect. Use top-scoring nodes as anchors for Approach 2.

---

## Approach 2 - Tightened branch query (structured context)

**Use when**: Approach 1 returned relevant nodes and you need full structured detail - all constraints, steps, and code references for those nodes.

Always anchor by node name(s) from Approach 1 results. Choose a **goal** to keep output focused.

### Full picture

```cypher
WITH ['Working Period Domain', 'Invoice Period Feature'] AS nodeNames
MATCH (seed) WHERE seed.name IN nodeNames
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed
RETURN seed.name AS name,
       seed.kind AS kind,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.kind, n.name]) AS neighbors
ORDER BY name;
```

### Domain/Feature detail (specific to knowledge nodes)

```cypher
WITH ['Working Period Domain'] AS domains
MATCH (d:Domain) WHERE d.name IN domains
OPTIONAL MATCH (d)-[:HAS_FEATURE]->(f:Feature)
OPTIONAL MATCH (f)-[:HAS_OPERATION]->(op:Operation)
OPTIONAL MATCH (op)-[:PERFORMED_BY]->(a:Actor)
OPTIONAL MATCH (f)-[:GOVERNED_BY]->(br:BusinessRule)
OPTIONAL MATCH (f)-[:IMPLEMENTED_BY]->(code)
RETURN d.name AS domain,
       d.summary AS description,
       collect(DISTINCT f.name) AS features,
       collect(DISTINCT op.name) AS operations,
       collect(DISTINCT a.name) AS actors,
       collect(DISTINCT br.name) AS businessRules
```

### Codebase detail (specific to codebase nodes)

```cypher
WITH ['UserNotificationsService'] AS names
MATCH (f:Function) WHERE f.name IN names
OPTIONAL MATCH (f)-[:PART_OF]->(c:Class)
OPTIONAL MATCH (f)-[:CALLS]->(s:Service)
OPTIONAL MATCH (f)-[:DEFINED_IN]->(file:File)
RETURN f.name AS function,
       f.summary AS summary,
       c.name AS class,
       collect(DISTINCT s.name) AS calls,
       file.name AS file
```

---

## Approach 3 - Kind-scoped search (domain narrowing)

**Use when**: Approach 1 returns too many scattered results from unrelated domains, or the task clearly belongs to a specific kind.

Pre-filter seeds by `kind` property, then apply text matching within that scope.

```cypher
WITH ['domain', 'feature'] AS kinds,
     ['update', 'edit'] AS terms
MATCH (seed)
WHERE seed.kind IN kinds
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t)
WITH seed,
  size([t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed
RETURN labels(seed)[0] AS type,
       seed.kind AS kind,
       seed.name AS name,
       score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.kind, n.name]) AS neighbors
ORDER BY relevance DESC, type, name
LIMIT 50;
```

---

## Approach 4 - Dependency disclosure (deep traversal)

**Use when**: text search returned good seeds but you suspect connected nodes are missing - constraints, operations, or relations that share no keyword with the search terms but are structurally linked.

Start from known node(s), traverse outward 1-2 hops to all connected nodes. **Use 1 hop first** to avoid result explosion.

**1 hop** (direct connections only):
```cypher
MATCH (start)
WHERE start.name IN ['Working Period Domain', 'Invoice Period Feature']
MATCH (start)-[r]-(neighbor)
WHERE neighbor <> start
RETURN DISTINCT labels(neighbor)[0] AS type,
       neighbor.kind AS kind,
       neighbor.name AS name,
       neighbor.summary AS summary,
       type(r) AS via
ORDER BY type, name
```

**2 hops** (deeper, use only when 1-hop misses expected context):
```cypher
MATCH (start)
WHERE start.name IN ['Working Period Domain']
MATCH (start)-[*1..2]-(neighbor)
WHERE neighbor <> start
RETURN DISTINCT labels(neighbor)[0] AS type,
       neighbor.kind AS kind,
       neighbor.name AS name,
       neighbor.summary AS summary
ORDER BY type, name
```

**Read results as**: nodes not visible in text search that are structurally part of the same topic. Cross-reference with Approach 1 results to identify what was missed.

---

## Approach 5 - Constraint fast-path

**Use when**: the entity or domain name is known (from any prior search or from the task description) and you need a quick safety check - what are the constraints and where are they enforced.

```cypher
MATCH (e:Entity)
WHERE e.name IN ['Working Period', 'Invoice Period']
OPTIONAL MATCH (e)-[:HAS_CONSTRAINT]->(c:Constraint)
OPTIONAL MATCH (c)-[:ENFORCED_IN]->(f:Function)
OPTIONAL MATCH (e)-[:DEFINED_IN]->(file:File)
RETURN e.name AS entity,
       e.summary AS summary,
       collect(DISTINCT c.name + ' [' + coalesce(c.constraintType,'?') + ']') AS constraints,
       collect(DISTINCT f.name) AS enforcingFunctions,
       collect(DISTINCT file.name) AS files
```

**Read results as**: a safety checklist. `constraints` = what validates or restricts the entity. `enforcingFunctions` + `files` = where to look for implementation scope.

---

## Approach 6 - File-based reverse lookup

**Use when**: an implementation plan already names specific files to modify. Reverses the lookup: file path -> Function/Class -> Domain/Entity/Constraint. Surfaces hidden business rules enforced in those files without reading them.

```cypher
WITH ['UserNotificationsService', 'NotificationType'] AS nameFragments
MATCH (f:Function)
WHERE any(nm IN nameFragments WHERE f.name CONTAINS nm)
  OR any(fp IN nameFragments WHERE f.filePath CONTAINS fp)
MATCH (f)-[:PART_OF]->(c:Class)
OPTIONAL MATCH (f)-[:CALLS]->(s:Service)
OPTIONAL MATCH (c)-[:DEFINED_IN]->(file:File)
OPTIONAL MATCH (f)-[:ENFORCES]->(constraint:Constraint)
RETURN f.name AS function,
       c.name AS class,
       s.name AS service,
       file.name AS file,
       collect(DISTINCT constraint.name) AS constraints
ORDER BY class, function
```

Partial file name fragments are enough - the query uses `CONTAINS`. The result shows which Functions and Classes are in those files, and what Constraints are attached to them.

---

## Schema quick-reference

To list all node names by kind (useful for exact name lookup):
```cypher
MATCH (n)
WHERE n.kind IN ['Domain', 'Feature', 'Entity', 'Concept', 'Function', 'Class']
RETURN n.kind AS kind, collect(n.name) AS names
ORDER BY kind
```

To inspect a specific node fully:
```cypher
MATCH (n) WHERE n.name = 'Working Period Domain' RETURN n
```

To list all domains:
```cypher
MATCH (n:Domain) RETURN n.key AS key, n.name AS name, n.summary AS summary
```

To list all features for a domain:
```cypher
MATCH (d:Domain {name: 'Working Period Domain'})-[:HAS_FEATURE]->(f:Feature)
RETURN f.key AS key, f.name AS name, f.featureType AS type
```

---

## Operational pitfalls observed in practice

These are common reasons the skill can appear to "not work" even when the graph and query strategy are correct:

- Do not check Java proactively. Java is only needed when `run-query.mjs` exits with code 2 (driver unavailable) and you need to fall back to `cypher-shell`.
- Credentials are loaded by `run-query.mjs` automatically: env vars → project `.env` → `~/.grasp-it/neo4j.env`. Do not assume credentials are only in the project `.env`.
- Sandbox/network restrictions can block Neo4j access with generic permission-style errors. The right response is to rerun the query with escalation, not to skip the graph step.
- Use `kind` property filtering to narrow results when the node type is known - it is more precise than filtering by label alone.