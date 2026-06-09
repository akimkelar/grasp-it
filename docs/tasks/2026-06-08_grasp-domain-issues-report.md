# Grasp-It: /grasp-domain Run — Issues & Fix Guide

_Produced: 2026-06-08 | Branch: VENDOR-9750-add-candidate-status-to-ui_

---

## Executive Summary

A `/grasp-domain` run on the AVAX Portal produced a partial, structurally incorrect Neo4j graph. The DB contains only two node labels (`CodeNode` for codebase nodes; `DomainElement` for domain nodes), whereas the plugin's schema documents and source code specify PascalCase individual labels (`File`, `Function`, `Class`, `Domain`, `Feature`, etc.). The codebase subgraph was written by an ad-hoc agent that did NOT use the standard `/grasp` pipeline (the file-analyzer agent + extract-structure.mjs), so nodes are missing semantic richness (no `tags`, no `lineRange`, no proper `kind = "codebase"`). All `CodeNode` nodes carry `kind = "knowledge"` — the wrong subgraph marker. The knowledge layer is present and mostly correct structurally, but it is not bridged to the codebase via `IMPLEMENTED_BY` edges pointing to the expected PascalCase-labelled counterparts. The `run-query.mjs` exit-code-2 problem is a driver misconfiguration, not a bug in the query itself. Running `/grasp` (the full analysis) before `/grasp-domain` would have produced both subgraphs correctly and then bridged them.

---

## 1. Node Label Schema Mismatch

### What the schema defines

Per `/Users/akravchyna/.grasp-it/repo/docs/architecture/neo4j-schema.md` and `/Users/akravchyna/.grasp-it/repo/docs/graph/architecture.md`, every node gets an **individual PascalCase label** derived from its `type` property via `toNeo4jLabel()`:

| Internal `type` | Expected Neo4j Label |
|---|---|
| `file` | `File` |
| `function` | `Function` |
| `class` | `Class` |
| `module` | `Module` |
| `config` | `Config` |
| `endpoint` | `Endpoint` |
| `table` | `Table` |
| `domain` | `Domain` |
| `feature` | `Feature` |
| `operation` | `Operation` |
| `actor` | `Actor` |
| `business-rule` | `BusinessRule` |
| `entity` | `Entity` |

The `toNeo4jLabel()` function in `/Users/akravchyna/.grasp-it-plugin/packages/core/src/schema.ts` (line 479–485) converts kebab-case to PascalCase: each hyphen-separated segment is capitalised and joined.

Additionally, each node carries a `kind` property (`"codebase"` | `"knowledge"`) as the logical subgraph separator.

### What is actually in Neo4j

```
MATCH (n) RETURN labels(n) AS lbl, n.type AS type, count(*) AS c ORDER BY c DESC
```

| Label | type | count |
|---|---|---|
| `["CodeNode"]` | method | 102 |
| `["CodeNode"]` | file | 33 |
| `["CodeNode"]` | class | 23 |
| `["DomainElement"]` | operation | 15 |
| `["DomainElement"]` | feature | 10 |
| `["DomainElement"]` | entity | 8 |
| `["DomainElement"]` | business-rule | 7 |
| `["DomainElement"]` | domain | 4 |
| `["CodeNode"]` | enum | 4 |
| `["DomainElement"]` | actor | 3 |
| `["Project"]` | NULL | 1 |
| `["CodeNode"]` | interface | 1 |

**Root cause:** The codebase nodes were not written by the standard `/grasp` pipeline. Instead, an ad-hoc mechanism (likely the `/grasp-domain` skill's Phase 4 fallback or a manual cypher session) wrote nodes with a generic `CodeNode` label rather than the per-type PascalCase label the persistence layer in `packages/core/src/persistence/index.ts` would normally emit.

The domain-graph's `saveDomainGraphToNeo4j()` function (`persistence/index.ts` line 344–400) correctly uses `DomainElement:<SecondaryLabel>` (e.g., `DomainElement:Domain`, `DomainElement:Feature`), but the codebase nodes that ended up as bare `CodeNode` labels should have been `File`, `Function`, `Class`, etc.

**Additionally**, all 163 `CodeNode` nodes have `kind = "knowledge"` — the wrong value. Codebase nodes must carry `kind = "codebase"`. The schema wipe query `MATCH (n) WHERE n.kind = "codebase" DETACH DELETE n` would not touch them, meaning stale codebase nodes accumulate forever.

### Dashboard impact

Any dashboard query that references `(n:File)`, `(n:Function)`, `(n:Class)` will return zero results. The `IMPLEMENTED_BY` bridge is also broken: domain elements point to `"file:..."` node IDs, but those nodes are labelled `CodeNode`, not `File`, so the bridge relationship traversal `(f:Feature)-[:IMPLEMENTED_BY]->(file:File)` fails.

---

## 2. Knowledge Layer — Definition and What's Missing

### What it is

The "knowledge layer" is the `kind = "knowledge"` subgraph documented in the architecture. It consists of:

- **Business Layer** (from `/grasp-domain` with `source: "code-analysis"`): `Domain`, `Feature`, `Operation`, `Actor`, `BusinessRule`, `Entity`
- **PO Interview Layer** (from `/grasp-requirements` with `source: "interview"`): `Decision`, `Constraint`, `Concept`, `Claim`, `Risk`

Nodes carry: `id`, `name`, `type`, `kind = "knowledge"`, `source`, `summary`, `tags`, `complexity`, `status`, plus type-specific fields (`ruleText` for `BusinessRule`, `permissions[]` for `Actor`, etc.).

### What is present vs. what is missing

**Present:** The business layer has been populated correctly — 47 `DomainElement` nodes with correct `kind = "knowledge"` and `source = "code-analysis"`, using the dual-label pattern `DomainElement:Domain`, `DomainElement:Feature`, etc.

**Missing:**
1. **`IMPLEMENTED_BY` relationships do not resolve**: The domain-graph.json file contains `implemented_by` edges (e.g., `feature:X → function:path:name`), but no corresponding `Function` nodes exist in Neo4j (they are `CodeNode` with `type = "method"`). The edges were written with `IMPLEMENTED_BY` relationship type (`MATCH ()-[r]->()` shows 40 such edges), but the targets are unreachable via `(f:Feature)-[:IMPLEMENTED_BY]->(fn:Function)` because no `Function` label exists.
2. **`Project` singleton missing `gitCommitHash`**: The `Project` node has `domainAnalyzedAt` and `domainCommit` but is missing `gitCommitHash` and `lastAnalyzedAt` — those are written by the `/grasp` full pipeline via `run-query.mjs` with a MERGE statement in Phase 7.
3. **No PO Interview Layer** — `Decision`, `Constraint`, `Concept`, `Claim`, `Risk` nodes are absent. These require `/grasp-requirements` to run.
4. **No layers or tour** — the `domain-graph.json` has `layers: []` and `tour: []`, and the grasp-domain skill spec intentionally leaves these empty (Phase 5 / SKILL.md line 140: `"layers and tour are intentionally empty for domain graphs"`).
5. **`RESTRICTED_FOR` relationship missing** — the schema defines it, but it is not in the DB.
6. **`USES` vs. `USES_ENTITY`** — the DB has 25 `USES` edges, but the schema calls for `USES_ENTITY`. These are different relationship type strings. The domain-analyzer agent prompt specifies `uses_entity` → `USES_ENTITY` after `toNeo4jRelationshipType()`. The DB showing `USES` suggests the agent emitted `uses` (which maps to `depends_on` in `EDGE_TYPE_ALIASES`), or the cypher was written manually with a different naming convention.

---

## 3. File Analyzer — What Was Bypassed

The `/grasp` full pipeline uses the `file-analyzer` agent (`/Users/akravchyna/.grasp-it-plugin/agents/file-analyzer.md`) to produce enriched codebase nodes. What it generates that was bypassed:

### Structural extraction (Phase 1 of file-analyzer)
The bundled `extract-structure.mjs` script uses tree-sitter for 10 languages to produce:
- `functions[]` with `name`, `startLine`, `endLine`, `params`
- `classes[]` with `name`, `startLine`, `endLine`, `methods`, `properties`
- `exports[]` with `name`, `line`, `isDefault`
- `callGraph[]` with `caller`, `callee`, `lineNumber`
- Structural metrics (`importCount`, `exportCount`, `functionCount`, `classCount`)

**For the AVAX Portal (Groovy/Grails):** Groovy is listed in the supported languages for tree-sitter in the file-analyzer. The current `CodeNode` nodes of type `method` (102 nodes) were produced by some other mechanism without line ranges or call graphs.

### Semantic enrichment (Phase 2 of file-analyzer)
The LLM agent adds to each node:
- `summary` — 1-2 sentence purpose description (PRESENT in CodeNodes, appears correct)
- `tags[]` — 3-5 lowercase hyphenated keywords (ABSENT from CodeNodes)
- `complexity` — `simple|moderate|complex` (ABSENT from CodeNodes)
- `lineRange` — `[startLine, endLine]` (ABSENT from CodeNodes)
- `languageNotes` — optional, language-specific patterns (ABSENT from CodeNodes)

### Rich edge types bypassed
The file-analyzer produces 26 edge types including:
- `contains` (File → Function/Class) — PRESENT in DB (130 edges)
- `imports` (File → File) — ABSENT from DB
- `calls` (Function → Function) — PRESENT (11 edges) but incomplete
- `inherits`, `implements` — PRESENT (4 + 2) but sparse
- `configures`, `documents`, `deploys`, `tested_by` — ABSENT
- `exports`, `depends_on`, `related` — ABSENT

The codebase subgraph has 163 nodes but only structural edges. Import graph, config edges, and documentation edges are entirely missing.

### Per-type node labels
As noted in Section 1, the file-analyzer writes nodes that the persistence layer converts to per-type labels via `toNeo4jLabel()`. The ad-hoc write path used a generic `CodeNode` label instead.

---

## 4. run-query.mjs Exit Code 2 — Root Cause

File: `/Users/akravchyna/.claude/plugins/cache/grasp-it/grasp-it/0.1.0/skills/grasp/run-query.mjs`

### The exit-2 path (lines 161–165)
```javascript
// Default: driver
const result = await runQueryViaDriver(neo4jConfig, query);
if (!result.ok && result.fallback) {
  // Driver failed with connection error — signal caller to use cypher-shell
  process.exit(2);
}
```

The driver path in `runQueryViaDriver()` (lines 38–90) returns `{ ok: false, reason, fallback: true }` in two cases:
1. `neo4j-driver` npm package is not installed — line 49: `"neo4j-driver not available"`
2. Any driver exception during session execution — lines 77–84

**Why it happens while cypher-shell works fine:**

The script loads `neo4j-driver` via dynamic ESM `import()` at runtime. The `neo4j-driver` package must be installed in the plugin's `node_modules`. If the plugin was installed without running `pnpm install` (or with a partial install), the driver package is absent.

Check: `ls /Users/akravchyna/.grasp-it-plugin/node_modules/neo4j-driver 2>/dev/null` — if empty, that is the root cause.

Additionally, the default URI used by the driver is `neo4j://localhost:7687` (line 47), whereas the DB is on `bolt://127.0.0.1:7687`. The protocol prefix `neo4j://` versus `bolt://` matters. The driver supports both, but if `NEO4J_URI` in the `.env` was set to `bolt://127.0.0.1:7687` with an older format the driver might not accept, it triggers a connection error → `fallback: true` → `process.exit(2)`.

**Exit code 2 meaning:** It is an intentional signal to the caller to retry with cypher-shell. The `/grasp` SKILL.md (lines 430–455) handles this fallback gracefully. Exit code 2 is not a failure — it is a protocol. If the caller does not handle it, the workflow fails.

**Fix:** Either install `neo4j-driver` (`pnpm install` in plugin root), or set `NEO4J_CONNECTION_TYPE=cypher-shell` in the project `.env` to bypass the driver path entirely.

---

## 5. Missing Graph Elements (Specific Node/Edge Types)

### Missing node labels (expected vs. actual)
| Expected Label | Actual | Count affected |
|---|---|---|
| `File` | `CodeNode` (type=file) | 33 |
| `Function` | `CodeNode` (type=method) | 102 |
| `Class` | `CodeNode` (type=class) | 23 |
| `Interface` | `CodeNode` (type=interface) | 1 |
| `Enum` | `CodeNode` (type=enum) | 4 |
| `Project` singleton with full properties | `Project` (missing gitCommitHash) | 1 |

### Missing relationship types
| Expected | Present | Notes |
|---|---|---|
| `:IMPORTS` | No | Import graph absent |
| `:USES_ENTITY` | `USES` used instead | Wrong relationship type name |
| `:RESTRICTED_FOR` | No | Domain actor restrictions absent |
| `:CONFIGURES` | No | Config file edges absent |
| `:IMPLEMENTED_BY` (resolvable) | 40 edges present but broken | Targets are `CodeNode` not typed label |

### Missing `kind` property values
All `CodeNode` nodes have `kind = "knowledge"` instead of `kind = "codebase"`. The schema wipe (`WHERE n.kind = "codebase"`) would leave these nodes forever, creating duplicates on subsequent runs.

### Missing node properties on CodeNodes
- `tags[]` — absent
- `complexity` — absent  
- `lineRange` — absent
- `languageNotes` — absent
- `analyzedAtCommit` — absent (needed for staleness detection per architecture docs)

### Missing `Project` singleton properties
The singleton has: `name`, `domainAnalyzedAt`, `id`, `domainCommit`
Missing: `gitCommitHash`, `lastAnalyzedAt`, `version`, `analyzedFiles`, `kind = "project"`

These are only written by the `/grasp` Phase 7 step which uses `run-query.mjs` to MERGE the `Project` singleton.

---

## 6. What /grasp Full Run Would Add

Running `/grasp` before `/grasp-domain` would have produced:

### Complete codebase subgraph with correct labels
- `File` nodes (33) with `kind = "codebase"`, `analyzedAtCommit`, `summary`, `tags`, `complexity`
- `Function` nodes with `lineRange`, `summary`, `tags`, `complexity`
- `Class` nodes with `lineRange`, `summary`, `tags`, `complexity`
- `Config` nodes for `.yml`, `.json`, `.groovy` config files
- `Document` nodes for Markdown docs
- `Pipeline` nodes for `.github/workflows` CI configs

### Rich edge set
- `:IMPORTS` — 487+ edges (estimated, based on project size; the `extract-import-map.mjs` script handles Groovy via Java-like import resolution)
- `:CONTAINS` — File → Function/Class (130 currently present)
- `:CALLS` — cross-file function call graph
- `:CONFIGURES` — config files → code modules
- `:TESTED_BY` — test ↔ production file coverage edges

### Architectural layers
- `Layer` objects classifying nodes into architectural tiers (UI, Domain, Service, Persistence, etc.)
- `tour` steps providing a guided walkthrough of the codebase

### Project singleton
- `Project {gitCommitHash, lastAnalyzedAt, version, analyzedFiles, kind: "project"}` — fully populated

### Bridged domain knowledge
When `/grasp-domain` runs after `/grasp`, it can use **Path 2** (Phase 4 of the SKILL.md): query the existing Neo4j knowledge graph (all `File` and `Function` nodes) rather than the lightweight file-tree scan (Path 1). The domain-analyzer receives actual summaries, tags, and relationships — substantially better domain extraction quality.

Additionally, the `IMPLEMENTED_BY` edges the domain-analyzer emits would target correctly-labelled `File` and `Function` nodes, making the bridge traversal work.

---

## 7. Recommended Fixes for the Plugin Developer

### Fix 1: Correct codebase node labels in Neo4j write path

The `grasp-domain` SKILL.md Phase 6b-2 (line ~230) states:
> "For each domain element, use cypher to `MERGE` (upsert) the node and create the `PART_OF` relationship."

But it does NOT specify a `saveDomainCodebaseNodes()` function — there is no persistence function for codebase nodes in `packages/core/src/persistence/index.ts`. The codebase nodes appear to have been written by an ad-hoc agent using a generic `CodeNode` label.

**Fix:** Either:
- (a) Remove codebase nodes from `/grasp-domain`'s scope entirely — they belong only in `/grasp`. The lightweight scan in Phase 3 should only produce context for the LLM, not write nodes.
- (b) Add a `saveCodebaseNodesToNeo4j()` function to `persistence/index.ts` that uses `toNeo4jLabel(node.type)` and sets `kind = "codebase"`.

The current ad-hoc write used `CodeNode` as the primary label instead of calling `toNeo4jLabel()`.

### Fix 2: Fix `kind` property on CodeNode writes

The 163 `CodeNode` nodes have `kind = "knowledge"`, which is incorrect for codebase nodes. Any fix must set `kind = "codebase"` on them.

Cypher to repair the existing graph:
```cypher
MATCH (n:CodeNode) WHERE n.kind = "knowledge" SET n.kind = "codebase"
```

### Fix 3: Fix `USES` → `USES_ENTITY` relationship name mismatch

The domain-analyzer agent emits edge type `uses_entity`. The `toNeo4jRelationshipType("uses_entity")` should produce `USES_ENTITY`. But the DB has `USES` (25 edges).

Check whether the SKILL.md Phase 6b write code is calling `toNeo4jRelationshipType()` or writing the relationship type raw. If the Cypher was written manually by the agent, it may have used `USES` instead of `USES_ENTITY`.

Cypher to repair:
```cypher
MATCH ()-[r:USES]->() 
WITH startNode(r) AS s, endNode(r) AS t
MERGE (s)-[:USES_ENTITY]->(t)
WITH s, t
MATCH (s)-[r:USES]->(t) DELETE r
```

### Fix 4: Ensure neo4j-driver is installed

```bash
cd /Users/akravchyna/.grasp-it-plugin
pnpm install
```

Or add to the project `.env`:
```
NEO4J_CONNECTION_TYPE=cypher-shell
```

The `run-query.mjs` exit-code-2 is handled by the SKILL.md gracefully, but silently failing to write domain nodes (because the caller doesn't check the fallback cypher-shell path in the domain write phase) is a separate bug.

### Fix 5: Enforce run order in documentation and skill guards

The `grasp-domain` skill (Phase 2) should check whether a `Project` singleton with a valid `gitCommitHash` exists. If it does not, the skill should warn:
> "No full `/grasp` analysis found. Running `/grasp-domain` standalone will produce a codebase subgraph with degraded quality. Run `/grasp` first for best results."

Currently the skill checks `Project.domainCommit` vs `Project.gitCommitHash` (Phase 2), but if `Project.gitCommitHash` is absent (no `/grasp` run ever), the check silently passes.

### Fix 6: Add secondary per-type labels to CodeNode writes

If codebase nodes must be written by `/grasp-domain` (e.g., as context anchors for `IMPLEMENTED_BY`), write them with dual labels matching the domain pattern:

```cypher
CREATE (n:CodeNode:File {id: $id, kind: "codebase", type: "file", ...})
```

This mirrors how domain elements use `DomainElement:Domain`, `DomainElement:Feature`, etc., and allows queries like `MATCH (n:File)` to work.

### Fix 7: Write `Project` singleton properties during `/grasp-domain` run

When `/grasp-domain` runs without a prior `/grasp` run, the `Project` singleton only gets `domainAnalyzedAt` and `domainCommit`. The domain SKILL.md should ensure the `Project` singleton is fully formed with `name`, `kind = "project"` at minimum so the singleton is properly initialized.

---

## Appendix: Current Neo4j State

**Database:** `grasp` at `bolt://127.0.0.1:7687`

### Node distribution
```
labels(n)         | type           | count
["CodeNode"]      | method         | 102
["CodeNode"]      | file           | 33
["CodeNode"]      | class          | 23
["DomainElement"] | operation      | 15
["DomainElement"] | feature        | 10
["DomainElement"] | entity         | 8
["DomainElement"] | business-rule  | 7
["DomainElement"] | domain         | 4
["CodeNode"]      | enum           | 4
["DomainElement"] | actor          | 3
["Project"]       | (none)         | 1
["CodeNode"]      | interface      | 1
Total: 205 + 1 Project
```

### Relationship distribution
```
type(r)          | count
CONTAINS         | 130
PART_OF          | 47
IMPLEMENTED_BY   | 40
USES             | 25    ← should be USES_ENTITY
HAS_OPERATION    | 18
USES_ENTITY      | 18    ← duplicate set (both USES and USES_ENTITY present)
CALLS            | 11
HAS_FEATURE      | 10
PERFORMED_BY     | 10
GOVERNS          | 10
SEQUENCE         | 7
IMPLEMENTS       | 4
EXTENDS          | 2
```

### Sample CodeNode properties
```json
{
  "id": "file:grails-app/controllers/com/avax/invoice/InvoiceController.groovy",
  "type": "file",
  "kind": "knowledge",   ← WRONG: should be "codebase"
  "name": "InvoiceController.groovy",
  "summary": "Grails controller managing client and agency invoice lifecycle...",
  "tags": ["surcharge", "invoice", "billing", "controller"]  ← present on some nodes
}
```

Note: Some `CodeNode` nodes have `tags` and `summary`, others do not. Inconsistency suggests the write was done by an LLM ad-hoc rather than via the structured file-analyzer pipeline.

### Sample DomainElement properties
```json
{
  "id": "domain:surcharge-configuration",
  "type": "domain",
  "kind": "knowledge",   ← CORRECT
  "source": "code-analysis",
  "name": "Surcharge Configuration",
  "summary": "Business domain covering definition, structure, and configuration...",
  "tags": ["surcharge", "configuration", "catalog"],
  "complexity": "complex",
  "status": "implemented"
}
```

### Project singleton (incomplete)
```json
{
  "id": "project:singleton",
  "name": "AVAX-Portal",
  "domainAnalyzedAt": "2026-06-08T12:57:54.867Z",
  "domainCommit": "e2e29bdc1cf55d308000e9d22af40c1daacc1dff"
  // MISSING: gitCommitHash, lastAnalyzedAt, version, analyzedFiles, kind
}
```

### Applied indexes/constraints
None visible (`SHOW CONSTRAINTS` and `CALL db.constraints()` return empty). The `setup-neo4j-schema.cypher` from `/Users/akravchyna/.claude/plugins/cache/grasp-it/grasp-it/0.1.0/skills/grasp/` was never applied — this means `MERGE` operations rely on sequential scan rather than index, and the uniqueness invariant for node IDs is not enforced.

### What the plugin must enforce to prevent this

The following bugs in the plugin's write path allowed these incorrect nodes to be created. Each must be fixed in the plugin so that no future run — whether ad-hoc agent or skill-driven — can produce `:CodeNode` nodes, wrong `kind` values, or missing labels.

#### Bug A — No label enforcement in the Neo4j write path

**File to fix:** The persistence module that MERGEs codebase nodes (likely `src/` or `packages/` under the plugin root — the function called `toNeo4jLabel()` or equivalent).

**What must change:** Every node written to Neo4j must receive its specific PascalCase label (`File`, `Function`, `Class`, `Interface`, `Enum`, `Layer`, etc.) derived from its `type` field. The write function must **reject or throw** if it receives a generic label like `CodeNode`. Add a label allowlist and a runtime assertion:
```js
const ALLOWED_LABELS = ['File','Function','Class','Interface','Enum','Module','Layer','Tour','Domain','Feature','Operation','Actor','BusinessRule','Entity','Project'];
if (!ALLOWED_LABELS.includes(label)) throw new Error(`Invalid node label: ${label}`);
```

#### Bug B — `kind` property not validated before write

**What must change:** The write path must assert that codebase nodes carry `kind = "codebase"` and knowledge/domain nodes carry `kind = "knowledge"`. A node arriving with `kind = "knowledge"` and `type = "file"` is a contract violation — reject it at the persistence layer, not silently write it.

#### Bug C — No schema setup step in `/grasp-domain`

**File to fix:** The `/grasp-domain` skill (Phase 0 or Phase 1).

**What must change:** Before any nodes are written, the skill must apply the Neo4j schema constraints (indexes, uniqueness) from `setup-neo4j-schema.cypher`. Currently this file is never executed in the domain skill path. Add a step:
```bash
# In skill Phase 0, after PROJECT_ROOT is resolved:
cypher-shell ... -f "$SKILL_DIR/../grasp/setup-neo4j-schema.cypher"
```

#### Bug D — `/grasp-domain` must hard-fail when no codebase graph exists

**File to fix:** `/grasp-domain` skill, Phase 2 (Detect Existing Graph).

**What must change:** If no `Project` singleton with a valid `gitCommitHash` exists in Neo4j, the skill must **stop and instruct the user to run `/grasp` first**, rather than silently falling through to the lightweight-scan path (Phase 3). The lightweight scan produces a domain graph with no codebase nodes to link against, resulting in broken `IMPLEMENTED_BY` edges. The fallback to Phase 3 should be removed or restricted to explicit `--no-graph` flag.

#### Bug E — Domain-analyzer agent must not be dispatched without a codebase graph

**File to fix:** `agents/domain-analyzer.md` and the dispatching logic in `/grasp-domain` Phase 5.

**What must change:** When the agent is dispatched via the lightweight-scan path (Option A), it must not produce `implemented_by` edges — there are no codebase nodes to target. The agent prompt must be conditional:
- Option A (no graph): produce domain/feature/operation/actor/entity/business-rule nodes only; omit all `implemented_by` edges
- Option B (graph exists): produce the full graph including `implemented_by` edges pointing to existing `:File`/`:Function`/`:Class` node IDs
