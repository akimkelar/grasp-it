---
name: graph-context-search
description: Query the Neo4j billing knowledge graph to get business context, constraints, risks, and code references before reading code. Use at the start of new tasks and before implementing modifications to avoid costly full-codebase searches.
allowed-tools: Bash
---

# Graph Context Search Skill

**Always query the knowledge graph before reading code.** The graph is the first and cheapest source of business context. Use it to understand the domain, rules, constraints, risks, and relevant file scope — so that subsequent code reading is targeted, not exploratory.

Only fall back to code reading after the graph has narrowed the scope, or when the graph does not contain the needed detail.

## When to use

- Starting a new task: query first to understand the domain, operations involved, and hidden constraints — before opening any files
- Before implementing a modification: surface risks, constraints, and impacted code files from the graph first
- Refining a task: check what an operation does and what guards it without reading the implementation
- Whenever a code search would be expensive or the scope is unclear — the graph answer is faster and cheaper

## Connection

Credentials are in the project `.env` file (`NEO4J_URI`, `NEO4J_DATABASE`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`).
Prefer shell sourcing because it is more reliable in this repository:

```bash
set -a
source .env >/dev/null 2>&1
set +a
```

### Runtime prerequisites

- Check the active Java version before querying.
- If Java 21 is available locally, prefer using Java 21 for `cypher-shell` before the first live graph query.
- If only an older or different Java is active, try to locate a Java 21 installation before the first live query.
- If Java 21 is not available, try the query once with the available Java and only switch if `cypher-shell` reports a Java/runtime compatibility error.
- Do not change Java for unrelated Gradle work in this repository. This Java preference is for Neo4j CLI usage only.

```bash
java -version
```

- If multiple Java versions are installed, use the platform-appropriate mechanism to inspect available versions and select Java 21 for the Neo4j CLI when possible.
- In this repository environment, live Neo4j access commonly needs network approval even when credentials are present locally.
- Request escalation proactively before the first live `cypher-shell` query so the skill does not fail partway through on the first graph read.
- If you still start sandboxed and hit connection or permission errors, rerun the same `cypher-shell` command with the required permissions instead of abandoning the skill.

### Quick health check

Run this before broader graph exploration when using the skill in a fresh environment:

```bash
java -version
set -a
source .env >/dev/null 2>&1
set +a
cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" \
  "MATCH (n:Operation) RETURN n.name LIMIT 3;"
```

If this fails:
- unsupported-Java or runtime-compatibility errors: switch to Java 21 if it is available locally, otherwise switch to a Java version accepted by the installed `cypher-shell`, then retry
- permission or connection-denied style failures: rerun with the required network approval / permissions
- auth or database errors: verify `.env` values and that `NEO4J_DATABASE` is loaded
- empty or irrelevant results: continue with the search approaches below using broader terms or feature-area scoping

Basic query execution:

```bash
cypher-shell -a $NEO4J_URI -u $NEO4J_USERNAME -p $NEO4J_PASSWORD -d $NEO4J_DATABASE "MATCH (n:Operation) RETURN n.name LIMIT 5;"
```

For multi-line queries, use a heredoc or pass a `.cypher` file with `-f`.

## Graph overview

**Node types** (business-first):

| Type | Purpose |
|---|---|
| `FeatureArea` | Product/architecture slice (e.g. `time_tracking`, `invoice_periods`) |
| `BusinessConcept` | Stable domain concept (e.g. Working Period, Draft Invoice) |
| `Operation` | Something the system or user can do (e.g. Update Invoice Period) |
| `BusinessRule` | What is allowed, required, or forbidden |
| `Constraint` | Specific validation or boundary condition |
| `Context` | Execution flow in which behavior is interpreted |
| `Impact` | Structural or recalculation effect of an operation |
| `Risk` | Dangerous behavior, hidden side effects |
| `DataArtifact` | Data structure used by the feature |
| `CodeEvidence` | Code-level evidence: class, method, file path |

**Key relations**:
```
Operation -[:GUARDED_BY]-> BusinessRule -[:SPECIALIZED_AS]-> Constraint
Operation -[:BLOCKED_BY]-> Constraint
Operation -[:CAUSES]-> Impact
Operation -[:HAS_RISK]-> Risk
Operation -[:RUNS_IN]-> Context
Operation -[:REQUIRES_FOLLOW_UP]-> Operation
Operation -[:IMPLEMENTED_BY]-> CodeEvidence
BusinessRule -[:EVIDENCED_BY]-> CodeEvidence
BusinessRule -[:HOLDS_IN]-> Context
Risk -[:EVIDENCED_BY]-> CodeEvidence
FeatureArea -[:HAS_OPERATION]-> Operation
```

**Searchable text fields per node**:
- All nodes: `name`, `summary`, `key`, `featureAreas` (array)
- Operation only: `defaultAnswerTemplate` (rich natural language description)
- Risk only: `recommendedMitigation`
- Context only: `entryPoints` (array of controller/route refs)

---

## Decision flow

```
New task received:
  → Connection health check if environment is fresh or untrusted
      → Java/runtime issue? → activate a Java version supported by the installed cypher-shell
      → permission/network issue? → rerun query with escalation
  → Approach 1 (broad text search, direct terms, core fields)
      → poor results? → retry with synonyms or shorter terms + more fields
      → too many scattered results? → Approach 3 (FeatureArea-scoped) → repeat
  → Approach 2 (branch query on top Operations)
      → reveals hidden constraints/risks not reachable by text
  → [optional] Approach 4 (dependency disclosure) if deeper investigation needed

Before/during modification:
  → Approach 5 (risk/constraint fast-path for named operations)
  → Approach 6 (file-based reverse lookup if files are already known)
  → [optional] Point lookup for specific nodes by key if clarification needed

Clarify individual nodes (optional, when a node name is known):
  MATCH (n) WHERE n.name = '...' RETURN n;
```

---

## Term search strategy

**Precision-first**: start with fewer fields and longer/specific terms. `name` and `summary` are the most semantically dense — written to be found. Extend only on poor results.

| Round | Fields searched | Terms |
|---|---|---|
| 1 | `name`, `summary` | Natural language phrases from the task (e.g. `'working period'`, `'period mutation'`) |
| 2 | + `key`, `defaultAnswerTemplate`, `recommendedMitigation` | Add synonyms or shorter phrases |
| 3 | + `entryPoints`, `featureAreas` | Single-word fallback terms |

`CodeEvidence` nodes are included in the label scope from round 1 — their `summary` fields use natural language, so phrase matching already catches them without needing code-style variants.

---

## Approach 1 — Broad text search (discovery)

**Use when**: starting investigation, scope is unknown, need to see what the graph knows about the topic.

Searches all business node types across core text fields. Scores seeds by number of term hits. Expands 1-hop to neighbor business nodes.

```cypher
WITH [
  'working period',
  'period update',
  'period edit',
  'period mutation'
] AS terms
MATCH (seed)
WHERE any(label IN labels(seed) WHERE label IN
      ['Operation','BusinessRule','Constraint','Risk','BusinessConcept','Context','Impact','FeatureArea','CodeEvidence'])
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t)
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE any(lbl IN labels(n) WHERE lbl IN
      ['Operation','BusinessRule','Constraint','Risk','Impact','Context'])
  AND n <> seed
RETURN labels(seed)[0] AS type, seed.name AS name, score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.name]) AS neighbors
ORDER BY relevance DESC, type, name
```

**On poor results** — extend to more fields:

```cypher
WITH ['working period', 'period', 'update'] AS terms   // shorter terms
MATCH (seed)
WHERE any(label IN labels(seed) WHERE label IN
      ['Operation','BusinessRule','Constraint','Risk','BusinessConcept','Context','Impact','FeatureArea'])
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.key) CONTAINS t
      OR (seed.defaultAnswerTemplate IS NOT NULL AND toLower(seed.defaultAnswerTemplate) CONTAINS t)
      OR (seed.recommendedMitigation IS NOT NULL AND toLower(seed.recommendedMitigation) CONTAINS t)
      OR any(ep IN coalesce(seed.entryPoints, []) WHERE toLower(ep) CONTAINS t)
      OR any(fa IN coalesce(seed.featureAreas, []) WHERE toLower(fa) CONTAINS t))
WITH seed,
  size([t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t
      OR toLower(seed.key) CONTAINS t
      OR (seed.defaultAnswerTemplate IS NOT NULL AND toLower(seed.defaultAnswerTemplate) CONTAINS t)
      OR (seed.recommendedMitigation IS NOT NULL AND toLower(seed.recommendedMitigation) CONTAINS t)
      OR any(ep IN coalesce(seed.entryPoints, []) WHERE toLower(ep) CONTAINS t)
      OR any(fa IN coalesce(seed.featureAreas, []) WHERE toLower(fa) CONTAINS t)]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE any(lbl IN labels(n) WHERE lbl IN
      ['Operation','BusinessRule','Constraint','Risk','Impact','Context'])
  AND n <> seed
RETURN labels(seed)[0] AS type, seed.name AS name, score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.name]) AS neighbors
ORDER BY relevance DESC, type, name
```

**Read results as**: scored seed nodes + flat neighbor lists. Tells you what exists in the graph and how nodes connect. Use top-scoring Operations as anchors for Approach 2.

**Practical note**: investigate each user question or topic separately first. Use focused terms per question, then compare the resulting operations, rules, and risks only after each topic has been narrowed independently.

---

## Approach 2 — Tightened branch query (structured context)

**Use when**: Approach 1 returned relevant Operations and you need full structured detail — all rules, constraints, impacts, risks, contexts, and code file refs for those operations.

Always anchor by operation name(s) from Approach 1 results. Choose a **goal** to keep output focused.

### Full picture

```cypher
WITH ['Update Invoice Period', 'Legacy Edit Working Period Popup'] AS opNames   // from Approach 1
MATCH (op:Operation) WHERE op.name IN opNames
OPTIONAL MATCH (op)-[:GUARDED_BY]->(rule:BusinessRule)
OPTIONAL MATCH (rule)-[:SPECIALIZED_AS]->(c:Constraint)
OPTIONAL MATCH (op)-[:CAUSES]->(impact:Impact)
OPTIONAL MATCH (op)-[:HAS_RISK]->(risk:Risk)
OPTIONAL MATCH (op)-[:RUNS_IN]->(ctx:Context)
OPTIONAL MATCH (op)-[:BLOCKED_BY]->(blocker:Constraint)
OPTIONAL MATCH (op)-[:IMPLEMENTED_BY]->(code:CodeEvidence)
OPTIONAL MATCH (op)-[:REQUIRES_FOLLOW_UP]->(followUp:Operation)
RETURN
  op.name AS operation,
  op.summary AS summary,
  coalesce(op.defaultAnswerTemplate, '') AS answerTemplate,
  collect(DISTINCT rule.name + ' [' + coalesce(rule.enforcementLevel,'?') + '/' + coalesce(rule.ruleKind,'?') + ']: ' + coalesce(rule.summary,'')) AS rules,
  collect(DISTINCT c.name + ' — ' + coalesce(c.failureEffect,'')) AS constraints,
  collect(DISTINCT impact.name + ' [cost=' + coalesce(impact.costLevel,'?') + ']') AS impacts,
  collect(DISTINCT risk.name + ' [sev=' + coalesce(risk.severity,'?') + ']: ' + coalesce(risk.recommendedMitigation,'')) AS risks,
  collect(DISTINCT ctx.name + ' | entry: ' + coalesce(reduce(s='', ep IN coalesce(ctx.entryPoints,[]) | s + ep + ' '),'')) AS contexts,
  collect(DISTINCT followUp.name) AS followUpOps,
  collect(DISTINCT code.name + ' → ' + coalesce(code.filePath,'')) AS codeRefs
```

### Goal-scoped variants

Use these when you only need a specific aspect to save tokens:

**Constraints only** (what guards/blocks the operation):
```cypher
MATCH (op:Operation) WHERE op.name IN ['Update Invoice Period']
OPTIONAL MATCH (op)-[:GUARDED_BY]->(rule:BusinessRule)-[:SPECIALIZED_AS]->(c:Constraint)
OPTIONAL MATCH (op)-[:BLOCKED_BY]->(blocker:Constraint)
RETURN op.name,
  collect(DISTINCT c.name + ' [' + coalesce(c.constraintType,'?') + '] — ' + coalesce(c.failureEffect,'')) AS constraintsViaRules,
  collect(DISTINCT blocker.name + ' — ' + coalesce(blocker.failureEffect,'')) AS blockers
```

**Risks + impacts only** (what can break):
```cypher
MATCH (op:Operation) WHERE op.name IN ['Update Invoice Period']
OPTIONAL MATCH (op)-[:HAS_RISK]->(risk:Risk)
OPTIONAL MATCH (op)-[:CAUSES]->(impact:Impact)
RETURN op.name,
  collect(DISTINCT risk.name + ' [sev=' + coalesce(risk.severity,'?') + ']: ' + coalesce(risk.recommendedMitigation,'')) AS risks,
  collect(DISTINCT impact.name + ' [cost=' + coalesce(impact.costLevel,'?') + ']') AS impacts
```

**Code refs only** (where to look in code):
```cypher
MATCH (op:Operation) WHERE op.name IN ['Update Invoice Period']
MATCH (op)-[:IMPLEMENTED_BY]->(code:CodeEvidence)
RETURN op.name, code.name AS method, code.filePath AS file, code.summary AS summary
```

---

## Approach 3 — FeatureArea-scoped search (domain narrowing)

**Use when**: Approach 1 returns too many scattered results from unrelated domains, or the task clearly belongs to a specific feature area.

Pre-filter seeds by `featureAreas` array, then apply text matching within that scope.

Available `featureAreas` values: `billing`, `time_tracking`, `time_import`, `invoice_periods`, `invoice_position_editing`, `recalculation`.

```cypher
WITH ['time_tracking', 'invoice_periods'] AS areas,   // domains relevant to the task
     ['update', 'edit'] AS terms                       // shorter terms after domain scoping
MATCH (seed)
WHERE any(label IN labels(seed) WHERE label IN
      ['Operation','BusinessRule','Constraint','Risk','BusinessConcept','Context','Impact'])
  AND any(fa IN coalesce(seed.featureAreas, []) WHERE any(area IN areas WHERE fa CONTAINS area))
  AND any(t IN terms WHERE
      toLower(seed.name) CONTAINS t
      OR toLower(seed.summary) CONTAINS t)
WITH seed,
  size([t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t]) AS score
OPTIONAL MATCH (seed)-[r]-(n)
WHERE any(lbl IN labels(n) WHERE lbl IN
      ['Operation','BusinessRule','Constraint','Risk','Impact','Context'])
  AND n <> seed
RETURN labels(seed)[0] AS type, seed.name AS name, score AS relevance,
       seed.summary AS summary,
       collect(DISTINCT [type(r), labels(n)[0], n.name]) AS neighbors
ORDER BY relevance DESC, type, name
```

---

## Approach 4 — Dependency disclosure (deep traversal)

**Use when**: text search returned good seeds but you suspect connected nodes are missing — rules, constraints, or risks that share no keyword with the search terms but are structurally linked.

Start from known node(s), traverse outward 1–2 hops to all connected business nodes. **Use 1 hop first** to avoid result explosion.

**1 hop** (direct connections only):
```cypher
MATCH (start)
WHERE start.name IN ['Update Invoice Period', 'Legacy Edit Working Period Popup']
MATCH (start)-[r]-(neighbor)
WHERE any(lbl IN labels(neighbor) WHERE lbl IN
      ['Operation','BusinessRule','Constraint','Risk','Impact','Context'])
  AND neighbor <> start
RETURN DISTINCT labels(neighbor)[0] AS type, neighbor.name AS name,
       neighbor.summary AS summary, type(r) AS via
ORDER BY type, name
```

**2 hops** (deeper, use only when 1-hop misses expected context):
```cypher
MATCH (start)
WHERE start.name IN ['Update Invoice Period']
MATCH (start)-[*1..2]-(neighbor)
WHERE any(lbl IN labels(neighbor) WHERE lbl IN
      ['Operation','BusinessRule','Constraint','Risk','Impact','Context'])
  AND neighbor <> start
RETURN DISTINCT labels(neighbor)[0] AS type, neighbor.name AS name, neighbor.summary AS summary
ORDER BY type, name
```

**Read results as**: nodes not visible in text search that are structurally part of the same topic. Cross-reference with Approach 1 results to identify what was missed.

---

## Approach 5 — Risk/constraint fast-path

**Use when**: the operation name is known (from any prior search or from the task description) and you need a quick safety check — what are the risks, what constraints guard it, and where is it in code. Useful for task refinement and modification planning.

```cypher
MATCH (op:Operation)
WHERE op.name IN ['Update Invoice Period']   -- one or more operation names
OPTIONAL MATCH (op)-[:HAS_RISK]->(risk:Risk)
OPTIONAL MATCH (op)-[:GUARDED_BY]->(rule:BusinessRule)-[:SPECIALIZED_AS]->(c:Constraint)
OPTIONAL MATCH (op)-[:BLOCKED_BY]->(blocker:Constraint)
OPTIONAL MATCH (op)-[:IMPLEMENTED_BY]->(code:CodeEvidence)
RETURN op.name AS operation, op.summary AS summary,
  collect(DISTINCT risk.name + ' [sev=' + coalesce(risk.severity,'?') + ']: ' + coalesce(risk.recommendedMitigation,'')) AS risks,
  collect(DISTINCT c.name + ' [' + coalesce(c.constraintType,'?') + '/' + coalesce(c.scope,'?') + '] — ' + coalesce(c.failureEffect,'')) AS constraintsViaRules,
  collect(DISTINCT blocker.name + ' [' + coalesce(blocker.constraintType,'?') + '/' + coalesce(blocker.scope,'?') + '] — ' + coalesce(blocker.failureEffect,'')) AS blockers,
  collect(DISTINCT code.name + ' → ' + coalesce(code.filePath,'')) AS codeRefs
```

**Read results as**: a safety checklist. `risks` = what can break silently or structurally. `constraintsViaRules` + `blockers` = what will throw errors or reject the request. `codeRefs` = files to read for implementation scope.

---

## Approach 6 — File-based reverse lookup

**Use when**: an implementation plan already names specific files to modify. Reverses the lookup: file path → CodeEvidence → Operation/BusinessRule/Risk → constraints, risks, impacts. Surfaces hidden business rules enforced in those files without reading them.

```cypher
WITH ['InvoicePeriodCommandService.groovy', 'InvoicePeriodsController.groovy'] AS filePaths   // partial file names work
MATCH (code:CodeEvidence)
WHERE any(fp IN filePaths WHERE code.filePath CONTAINS fp)
MATCH (code)<-[:IMPLEMENTED_BY|EVIDENCED_BY]-(parent)
WHERE any(lbl IN labels(parent) WHERE lbl IN ['Operation','BusinessRule','Risk'])
OPTIONAL MATCH (parent)-[:HAS_RISK]->(risk:Risk)
OPTIONAL MATCH (parent)-[:GUARDED_BY]->(rule:BusinessRule)-[:SPECIALIZED_AS]->(c:Constraint)
OPTIONAL MATCH (parent)-[:BLOCKED_BY]->(blocker:Constraint)
OPTIONAL MATCH (parent)-[:CAUSES]->(impact:Impact)
RETURN labels(parent)[0] AS type, parent.name AS name, parent.summary AS summary,
  collect(DISTINCT risk.name + ' [sev=' + coalesce(risk.severity,'?') + ']: ' + coalesce(risk.recommendedMitigation,'')) AS risks,
  collect(DISTINCT c.name + ' — ' + coalesce(c.failureEffect,'')) AS constraints,
  collect(DISTINCT impact.name + ' [cost=' + coalesce(impact.costLevel,'?') + ']') AS impacts
ORDER BY type, name
```

Partial file name fragments are enough — the query uses `CONTAINS`. The result shows which Operations and BusinessRules are implemented in those files, and what risks/constraints are attached to them.

---

## Schema quick-reference

To list all node names by type (useful for exact name lookup):
```cypher
MATCH (n)
WHERE any(lbl IN labels(n) WHERE lbl IN ['Operation','FeatureArea','Context'])
RETURN labels(n)[0] AS type, collect(n.name) AS names
ORDER BY type
```

To inspect a specific node fully:
```cypher
MATCH (n) WHERE n.name = 'Update Invoice Period' RETURN n
```

To list all feature areas:
```cypher
MATCH (n:FeatureArea) RETURN n.key AS key, n.name AS name, n.summary AS summary
```

---

## Operational pitfalls observed in practice

These are common reasons the skill can appear to "not work" even when the graph and query strategy are correct:

- The repository or surrounding toolchain may use a different Java version than the Neo4j CLI. Treat graph querying as a separate runtime concern and use a Java version supported by the installed `cypher-shell`.
- Sandbox/network restrictions can block Neo4j access with generic permission-style errors. The right response is to rerun the query with escalation, not to skip the graph step.
- `source .env` is more reliable than `export $(grep '^NEO4J_' .env | xargs)` for this repo — prefer it when env vars are not loading correctly.
