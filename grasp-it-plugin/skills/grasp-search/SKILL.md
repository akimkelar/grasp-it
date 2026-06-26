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

### Quick health check

Run this before broader graph exploration when using the skill in a fresh environment:

```bash
GRASP_SKILL_DIR="$(cd "$(dirname "$0")/../grasp" && pwd)"
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN labels(n)[0] AS label LIMIT 3"
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
GRASP_SKILL_DIR="$(cd "$(dirname "$0")/../grasp" && pwd)"
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN n.name LIMIT 5"
```

For multi-line queries, pass a single-line query or use a temporary `.cypher` file with `cypher-shell -f`.

## Graph overview

The graph uses a single Neo4j database with two logical subgraphs, separated by the `kind` node property.

**Codebase nodes** (`kind: "codebase"`) — structure and implementation:

| Label | Purpose |
|---|---|
| `File` | Source file |
| `Function` | Function or method |
| `Class` | Class or struct |
| `Module` | Module or package |
| `Config` | Configuration file or entry |
| `Table` | Database table |
| `Endpoint` | HTTP API endpoint |
| `Document` | Documentation file (README, docs/) |
| `Service` | Container/service definition (Dockerfile, docker-compose, k8s) |
| `Pipeline` | CI/CD pipeline or build target |
| `Schema` | Protobuf/OpenAPI/GraphQL schema definition |
| `Resource` | Infrastructure-as-code resource (Terraform, CloudFormation) |

**Knowledge nodes** (`kind: "knowledge"`) — business and domain:

| Label | Purpose | `source` value |
|---|---|---|
| `Domain` | Business domain | `"code-analysis"` |
| `Feature` | Named product capability | `"code-analysis"` or `"concept"` |
| `Operation` | A meaningful action within a feature | `"code-analysis"` or `"concept"` |
| `Actor` | User role or system agent | `"code-analysis"` or `"concept"` |
| `BusinessRule` | Business rule or policy | `"code-analysis"` or `"concept"` |
| `Entity` | Named business object | `"code-analysis"` or `"concept"` |
| `Risk` | Implementation hazard or business exposure | `"code-analysis"` or `"concept"` |
| `Constraint` | Technical invariant or access condition | `"code-analysis"` or `"concept"` |
| `Decision` | Resolved question or commitment | `"concept"` |
| `Concept` | Key abstraction named by a specialist | `"concept"` |
| `Claim` | Assertion made during concept plan | `"concept"` |

**Key relationships**:

```
-- Codebase structure (all nodes have kind: "codebase")
File      -[:CONTAINS]->      Function / Class
File      -[:IMPORTS]->       File
File      -[:EXPORTS]->       Function / Class
Class     -[:INHERITS]->      Class
Class     -[:IMPLEMENTS]->    Class
Function  -[:CALLS]->         Function
Endpoint  -[:EXPOSES]->       Function
Function  -[:READS_FROM]->    Table / Endpoint
Function  -[:WRITES_TO]->     Table / Endpoint
Function  -[:TRANSFORMS]->    Table / Endpoint
Function  -[:VALIDATES]->     *
Function  -[:SUBSCRIBES]->    *
Function  -[:PUBLISHES]->     *
Function  -[:MIDDLEWARE]->    Function
*         -[:CONFIGURES]->    Config
*         -[:TESTED_BY]->     *
*         -[:DEPENDS_ON]->    *
*         -[:RELATED]->       *
*         -[:SIMILAR_TO]->    *
Document  -[:DOCUMENTS]->     File
File      -[:DEPLOYS]->       File
File      -[:MIGRATES]->      Table
Pipeline  -[:TRIGGERS]->      Pipeline
Schema    -[:DEFINES_SCHEMA]-> *
Service   -[:SERVES]->        Endpoint
Resource  -[:PROVISIONS]->    *
File      -[:ROUTES]->        Endpoint

-- Note: Class methods are NOT separate nodes.
--   cls.methods is a string[] property on the Class node.
--   There is no Class→Function edge. Use cls.filePath to find related functions.

-- Knowledge domain (stored as named relationship types)
Domain       -[:HAS_FEATURE]->    Feature
Feature      -[:HAS_OPERATION]->  Operation
Operation    -[:SEQUENCE]->       Operation
Operation    -[:PERFORMED_BY]->   Actor
Operation    -[:RESTRICTED_FOR]-> Actor
Feature      -[:USES_ENTITY]->    Entity
Operation    -[:USES_ENTITY]->    Entity
BusinessRule -[:GOVERNS]->        Feature / Operation
Feature      -[:HAS_RISK]->       Risk
Operation    -[:HAS_RISK]->       Risk
BusinessRule -[:HAS_RISK]->       Risk
Risk         -[:MITIGATED_BY]->   Decision / Constraint
Feature      -[:CONSTRAINED_BY]-> Constraint
Decision     -[:CONSTRAINED_BY]-> Constraint
Decision     -[:DECIDES]->        Feature / BusinessRule
Decision     -[:IMPLEMENTS]->     Concept
Concept      -[:SUB_CONCEPT_OF]-> Concept
Claim        -[:SUPPORTS]->       Claim / Decision
Constraint   -[:APPLIES_IN]->     Feature / Operation / Concept
BusinessRule -[:APPLIES_IN]->     Concept

-- Bridge
Feature / Operation / BusinessRule -[:IMPLEMENTED_BY]-> File / Function / Class / Endpoint
```

**Searchable text fields per node**:
- All nodes: `name`, `summary`, `id`
- Knowledge nodes: `kind = "knowledge"`, also `source` (`"code-analysis"` | `"concept"`)
- Codebase nodes: `kind = "codebase"`, also `filePath`, `complexity`
- `Feature` / `Operation`: `status` (`"planned"` | `"partial"` | `"implemented"`)
- `Risk`: `severity`, `probability`
- `Constraint`: `condition`, `invariant`

---

## Decision flow

```
New task received:
  -> Connection health check if environment is fresh or untrusted
      -> exit code 2? -> fall back to cypher-shell (Java needed only here)
      -> permission/network issue? -> rerun query with escalation
  -> Approach 1 (broad text search, direct terms, core fields)
      -> poor results? -> retry with synonyms or shorter terms + more fields
      -> too many scattered results? -> Approach 3 (label-scoped) -> repeat
      -> scope is known to be code elements? -> Approach A (codebase lookup)
      -> scope is known to be from code analysis? -> Approach B (code-analysis lookup)
      -> scope is known to be from concept plans? -> Approach C (concept lookup)
  -> Approach 2 (branch query on top entities)
      -> reveals hidden constraints not reachable by text
  -> [optional] Approach 4 (dependency disclosure) if deeper investigation needed

Before/during modification:
  -> Approach 5 (constraint fast-path for named features or operations)
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
| 2 | + `id`, `condition`, `invariant` | Add synonyms or shorter phrases |
| 3 | Narrow by label in `WHERE` clause | Single-word fallback terms |

Use label filtering (`WHERE seed:Domain OR seed:Feature`) to narrow to specific node categories.

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

**On poor results** - extend to more fields with label filtering:

```cypher
WITH ['working period', 'period', 'update'] AS terms
MATCH (seed)
WHERE (seed:Domain OR seed:Feature OR seed:Entity OR seed:Operation OR seed:Concept OR seed:Constraint)
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.id) CONTAINS t
      OR toLower(coalesce(seed.condition, '')) CONTAINS t
      OR toLower(coalesce(seed.invariant, '')) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.id) CONTAINS t]) AS score
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
OPTIONAL MATCH (br:BusinessRule)-[:GOVERNS]->(f)
OPTIONAL MATCH (f)-[:IMPLEMENTED_BY]->(code)
RETURN d.name AS domain,
       d.summary AS description,
       collect(DISTINCT f.name) AS features,
       collect(DISTINCT op.name) AS operations,
       collect(DISTINCT a.name) AS actors,
       collect(DISTINCT br.name) AS businessRules,
       collect(DISTINCT code.filePath) AS files
```

### Codebase detail (specific to codebase nodes)

Codebase edges use named Neo4j relationship types (`:CONTAINS`, `:CALLS`, `:IMPORTS`, etc.) — NOT `:RELATES {type: "..."}`. The `RELATES` pattern was a previous implementation detail that has been removed.

```cypher
WITH ['UserNotificationsService'] AS names
MATCH (fn:Function) WHERE fn.name IN names
OPTIONAL MATCH (file:File)-[rc:CONTAINS]->(fn)
OPTIONAL MATCH (fn)-[rca:CALLS]->(called:Function)
RETURN fn.name AS function,
       fn.summary AS summary,
       fn.filePath AS filePath,
       file.name AS inFile,
       collect(DISTINCT called.name) AS calls
```

To explore all edges of a codebase node (any type):
```cypher
MATCH (fn:Function {name: 'UserNotificationsService'})
OPTIONAL MATCH (fn)-[r]->(out)
WHERE out.kind = "codebase"
OPTIONAL MATCH (fn)<-[ri]-(in)
WHERE in.kind = "codebase"
RETURN fn.name, fn.filePath, fn.summary,
       collect(DISTINCT {dir: '→', type: type(r), target: out.name}) AS outEdges,
       collect(DISTINCT {dir: '←', type: type(ri), src: in.name}) AS inEdges
```

To find what class a function/method belongs to, use `filePath` overlap — there is no Class→Function edge:
```cypher
MATCH (cls:Class) WHERE cls.filePath = 'src/services/UserNotifications.ts'
RETURN cls.name, cls.methods, cls.properties
```

---

## Approach 3 - Label-scoped search (domain narrowing)

**Use when**: Approach 1 returns too many scattered results from unrelated domains, or the task clearly belongs to a specific node type.

Pre-filter seeds by label, then apply text matching within that scope.

```cypher
WITH ['update', 'edit'] AS terms
MATCH (seed)
WHERE (seed:Domain OR seed:Feature)
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

## Approaches A-C - Subgraph-scoped lookup

For queries that need to target a specific logical region of the graph, use these approaches instead of (or after) the general approaches above. Each scopes to one of the three subgraph regions defined by `kind` and `source` properties.

---

## Approach A - Codebase lookup

**Use when**: searching for code elements (files, functions, classes, modules, endpoints). Filters to `kind: "codebase"` only. Useful when you know the topic maps to implementation artifacts rather than business concepts.

```cypher
WITH ['<term>'] AS terms
MATCH (seed)
WHERE seed.kind = "codebase"
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.filePath) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.filePath) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed AND n.kind = "codebase"
RETURN labels(seed)[0] AS type,
       seed.name AS name,
       seed.filePath AS filePath,
       seed.complexity AS complexity,
       score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.name]) AS neighbors
ORDER BY relevance DESC, type, name
LIMIT 50;
```

**Returns**: code element type (`Codebase:File`, `Codebase:Function`, etc.), name, file path, complexity, relevance score, summary, and direct code-to-code neighbors (e.g., `CONTAINS`, `CALLS`, `IMPORTS`).

---

## Approach B - Code-analysis knowledge lookup

**Use when**: finding what the codebase currently does — features, operations, entities, rules that were extracted from code by `/grasp-domain`. Filters to `kind: "knowledge"` and `source: "code-analysis"`.

```cypher
WITH ['<term>'] AS terms
MATCH (seed)
WHERE seed.kind = "knowledge"
  AND seed.source = "code-analysis"
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.id) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.id) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed
RETURN labels(seed)[0] AS type,
       seed.name AS name,
       seed.summary AS summary,
       seed.status AS status,
       score AS relevance,
       seed.sourceFiles AS sourceFiles,
       collect(DISTINCT [type(r), labels(n)[0], n.kind, n.name]) AS neighbors
ORDER BY relevance DESC, type, name
LIMIT 50;
```

**Returns**: knowledge node type, name, summary, status (for Feature/Operation), source files analyzed to derive this node, and all neighbors (including `IMPLEMENTED_BY` links to code).

---

## Approach C - Concept knowledge lookup

**Use when**: finding what the specialist intends — planned features, decisions, constraints, concepts captured by `/grasp-concept`. Filters to `kind: "knowledge"` and `source: "concept"`. This is the primary discovery mechanism for Decision, Concept, and Claim nodes.

```cypher
WITH ['<term>'] AS terms
MATCH (seed)
WHERE seed.kind = "knowledge"
  AND seed.source = "concept"
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.id) CONTAINS t
      OR toLower(coalesce(seed.rationale, '')) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.id) CONTAINS t
      OR toLower(coalesce(seed.rationale, '')) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE n <> seed
RETURN labels(seed)[0] AS type,
       seed.name AS name,
       seed.summary AS summary,
       seed.status AS status,
       seed.confidence AS confidence,
       score AS relevance,
       collect(DISTINCT [type(r), labels(n)[0], n.kind, n.name]) AS neighbors
ORDER BY relevance DESC, type, name
LIMIT 50;
```

**Returns**: concept node type (including Decision, Concept, Claim), name, summary, status (for Decision), confidence (for Claim), and all neighbors.

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

**Use when**: a feature or operation name is known and you need a quick safety check — what constraints govern it, what risks are attached, and which code files implement it.

```cypher
MATCH (f)
WHERE f.name IN ['Working Period Feature', 'Invoice Period Feature']
  AND f.kind = "knowledge"
OPTIONAL MATCH (f)-[:CONSTRAINED_BY]->(cn:Constraint)
OPTIONAL MATCH (br:BusinessRule)-[:GOVERNS]->(f)
OPTIONAL MATCH (f)-[:HAS_RISK]->(rk:Risk)
OPTIONAL MATCH (f)-[:IMPLEMENTED_BY]->(code)
RETURN f.name AS node,
       labels(f)[0] AS type,
       collect(DISTINCT cn.name + ' — ' + coalesce(cn.condition, cn.invariant, '?')) AS constraints,
       collect(DISTINCT br.name) AS businessRules,
       collect(DISTINCT {name: rk.name, severity: rk.severity}) AS risks,
       collect(DISTINCT code.filePath) AS files
```

**Read results as**: a safety checklist. `constraints` = what invariants apply. `businessRules` = governing policies. `risks` = known hazards. `files` = where to look for implementation scope.

---

## Approach 6 - File-based reverse lookup

**Use when**: an implementation plan already names specific files to modify. Reverses the lookup: file path → Function/Class → knowledge nodes (Feature/Operation/BusinessRule). Surfaces hidden business rules and constraints tied to those files without reading them.

Codebase edges (named relationship types like `:CONTAINS`, `:CALLS`) and knowledge-bridge edges (`:IMPLEMENTED_BY`) use different patterns.

```cypher
WITH ['UserNotificationsService', 'NotificationType'] AS nameFragments
MATCH (fn:Function)
WHERE any(nm IN nameFragments WHERE fn.name CONTAINS nm)
   OR any(fp IN nameFragments WHERE fn.filePath CONTAINS fp)
OPTIONAL MATCH (file:File)-[rc:CONTAINS]->(fn)
OPTIONAL MATCH (kn)-[:IMPLEMENTED_BY]->(fn)
WHERE kn.kind = "knowledge"
OPTIONAL MATCH (br:BusinessRule)-[:GOVERNS]->(kn)
OPTIONAL MATCH (kn)-[:CONSTRAINED_BY]->(cn:Constraint)
RETURN fn.name AS function,
       fn.filePath AS filePath,
       file.name AS inFile,
       collect(DISTINCT {label: labels(kn)[0], name: kn.name}) AS knowledgeNodes,
       collect(DISTINCT br.name) AS businessRules,
       collect(DISTINCT cn.name) AS constraints
ORDER BY filePath, function
```

To find all functions in a file and what they call:
```cypher
MATCH (file:File {filePath: 'src/services/UserNotifications.ts'})
MATCH (file)-[:CONTAINS]->(fn:Function)
OPTIONAL MATCH (fn)-[:CALLS]->(callee:Function)
RETURN fn.name, fn.summary, collect(DISTINCT callee.name) AS calls
ORDER BY fn.name
```

Partial file name fragments are enough — the query uses `CONTAINS`. The result shows which knowledge concepts are realized by those functions, and what rules constrain them.

---

## Schema quick-reference

To list all node names by subgraph:
```cypher
MATCH (n)
WHERE n.kind IN ["knowledge", "codebase"]
RETURN n.kind AS kind, labels(n)[0] AS label, collect(n.name) AS names
ORDER BY kind, label
```

To list knowledge nodes by type:
```cypher
MATCH (n)
WHERE n.kind = "knowledge"
  AND (n:Domain OR n:Feature OR n:Entity OR n:Concept OR n:Constraint OR n:Risk)
RETURN labels(n)[0] AS label, n.name AS name, n.summary AS summary
ORDER BY label, name
```

To inspect a specific node fully:
```cypher
MATCH (n) WHERE n.name = 'Working Period Domain' RETURN n
```

To list all domains:
```cypher
MATCH (n:Domain) RETURN n.id AS id, n.name AS name, n.summary AS summary
```

To list all features for a domain:
```cypher
MATCH (d:Domain {name: 'Working Period Domain'})-[:HAS_FEATURE]->(f:Feature)
RETURN f.id AS id, f.name AS name, f.status AS status, f.source AS source
```

To list features by implementation status:
```cypher
MATCH (n:Feature)
RETURN n.status AS status, collect(n.name) AS features
ORDER BY status
```

---

## Operational pitfalls observed in practice

These are common reasons the skill can appear to "not work" even when the graph and query strategy are correct:

- Do not check Java proactively. Java is only needed when `run-query.mjs` exits with code 2 (driver unavailable) and you need to fall back to `cypher-shell`.
- Credentials are loaded by `run-query.mjs` automatically: env vars → project `.env` → `~/.grasp-it/neo4j.env`. Do not assume credentials are only in the project `.env`.
- Sandbox/network restrictions can block Neo4j access with generic permission-style errors. The right response is to rerun the query with escalation, not to skip the graph step.
- Use label predicates (`WHERE seed:Domain OR seed:Feature`) to narrow by node type — `n.kind` only distinguishes `"codebase"` from `"knowledge"`, it does not encode the node label.
- `BusinessRule -[:GOVERNS]-> Feature/Operation` — the direction is from rule to target, not the other way around. Queries traversing `[:GOVERNED_BY]` will return nothing.
- `File -[:CONTAINS]-> Function/Class/Module` — use `CONTAINS`, not `DEFINES` or `PART_OF`.
- Codebase edges use named relationship types (`:CONTAINS`, `:CALLS`, `:IMPORTS`, `:INHERITS`, `:IMPLEMENTS`, `:READS_FROM`, `:WRITES_TO`, `:CONFIGURES`, `:TESTED_BY`, `:DEPENDS_ON`, `:DOCUMENTS`, `:DEPLOYS`, etc.), NOT `:RELATES {type: '...'}`. The `RELATES` pattern was a previous implementation detail that has been fixed.
- Class methods are NOT sub-nodes — they are stored as a `methods: string[]` property on the `Class` node. There is no `Class→Function` edge in the graph. To find functions in the same file as a class, match by `cls.filePath`.
