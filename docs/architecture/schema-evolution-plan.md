# Schema Evolution Plan

## Context

The primary purpose of Grasp-It has shifted. The most important workflow is now:

1. **`/grasp-domain`** — mine business domain and feature knowledge from the codebase
2. **`/grasp-requirements`** — interview the Product Owner to extract planned feature knowledge (business rules,
   decisions, constraints, actors, operations)

The resulting graphs are then used to create tasks, build implementation plans, design test cases,
and drive implementation.

---

## Final Decisions (settled)

These questions were investigated and resolved. Do not reopen without strong new evidence.

### Single database

**Decision: one Neo4j database, two logical subgraphs separated by the `kind` property.**

The primary use case requires `IMPLEMENTED_BY` to be a native Neo4j relationship traversable
in both directions ("which files implement this feature?" / "which features touch this file?").
That is only possible within a single database. Two separate databases would force an
application-layer join and kill path queries, shortest-path, and variable-length expansions —
exactly the value Neo4j is being used for.

The cost asymmetry (scripts rebuild codebase cheaply; knowledge is slow-changing) is solved at
write time, not storage time: wipe `kind = "codebase"` nodes before each `/grasp` run, then
rebuild. Knowledge nodes survive.

### Drop `Flow` and `Step`

**Decision: removed from the schema.**

`Flow` and `Step` are redundant with `Operation + SEQUENCE`. An ordered chain of operations is
a flow. Keeping both would split the same concept across two node types with no query benefit.

### Deferred nodes

The following nodes from earlier drafts and the `docs/architecture/approaches/feature-development-graph-design.md` document
are **deferred** — they have no script signal, require speculative LLM extraction, and can be
modeled as `tags[]`, `scope[]`, or `BusinessRule` text until a concrete use case justifies them:

`Risk`, `Impact`, `Context`, `StateTransition`, `ViewArtifact`, `DataArtifact`, `Evidence`,
`Process`, `RuleAssessment`, `Claim`, `Article`, `Topic`, `Source`, `Pipeline`, `Schema`,
`Resource`, `Service`, `Concept`, `SubFeature`

### Final node set

**Codebase (scripts + LLM summaries):** `File`, `Function`, `Class`, `Module`, `Config`,
`Table`, `Endpoint`

**Knowledge (LLM-produced):** `Domain`, `Feature`, `Operation`, `Actor`, `Entity`,
`BusinessRule`, `Decision`, `Constraint`

**Bridge:** `IMPLEMENTED_BY` (`Feature / Operation / BusinessRule` → `File / Function / Class /
Endpoint`) with `{status, confidence}` — native relationship, single DB.

The current schema serves code analysis well. It is missing the **product knowledge layer** needed
to represent features, actors, business rules, and operations — the vocabulary that comes out of
a PO interview and that bridges intent to implementation.

---

## How the Codebase Is Mined (Script Capabilities)

Before deciding what to add, it is critical to understand what the extraction scripts actually
produce — because nodes that cannot be extracted by script must be produced by LLM, which costs
tokens and time.

### What the scripts extract (zero business semantics)

**`extract-import-map.mjs`** (tree-sitter, project-wide):
- Resolved import edges: `file → [list of imported project files]`
- Pure graph edges. No names, no meaning, no summaries.

**`extract-structure.mjs`** (tree-sitter, per-file batch):
- Function names + line ranges + parameter names
- Class names + line ranges + method names + property names
- Export names (which are default)
- Endpoint facts: HTTP method + URL path + line range
- Call graph: caller name → callee name + line number
- Services, resources, pipeline steps (from non-code files like docker-compose, k8s manifests)
- Metrics: function count, class count, import count, export count
- **No summaries. No business meaning. No feature grouping.**

**`extract-domain-context.py`** (regex + file walking, domain prep):
- File tree (up to 5000 files)
- Entry points detected by regex: HTTP routes (Express/Flask/FastAPI/NestJS/Next.js), CLI
  commands, event listeners, cron jobs, gRPC services, exported handlers
- File signatures: exports, imports, first 500 chars of file — for top 40 files scored by
  business-looking names (`controller`, `service`, `handler`, `usecase`, `workflow`, etc.)
- Project metadata: package.json (name, description, scripts, dependencies), README, go.mod, etc.
- **This is raw material for the LLM, not business knowledge itself.**

### What requires LLM

Everything that requires interpreting meaning — not just structure — requires LLM tokens:
- Summaries and descriptions
- Tags and layer assignments
- Grouping code into business domains and features
- Identifying which operations belong to which feature
- Naming actors, business rules, constraints from code behavior

### Implication for `Feature` nodes

`Feature` nodes **cannot be extracted deterministically**. The scripts surface signals —
HTTP route paths, controller names, directory layout, service names — but mapping those
signals to named business features requires semantic reasoning.

What the scripts do provide that helps the LLM infer Features cheaply:
- URL paths often encode feature names (`/api/interviews`, `/api/invoices/:id`)
- File naming conventions encode intent (`InterviewController`, `InvoiceService`)
- Directory structure often mirrors features (`src/features/interview/`)
- export names hint at operations (`createInterview`, `scheduleInterview`)

These signals already flow into `extract-domain-context.py` output. The domain-analyzer LLM
already consumes them to produce `Domain` and `Flow` nodes. Adding `Feature` extraction to
the domain-analyzer is a natural extension — it reads the same input, costs the same tokens,
and produces a richer output.

**No new script work is needed.** The domain-analyzer prompt needs to be extended to produce
`Feature` nodes alongside `Domain` / `Flow` / `Step`.

---

## What to Add

### New Knowledge Nodes

#### `Feature`

The central anchor between a business domain and its implementation. A `Feature` is a named,
durable product capability — not a ticket, not a sprint item. Examples: "Interview Scheduling",
"Offer Acceptance", "Invoice Assignment".

Properties:
- `id: string` — e.g. `feature:interview-scheduling`
- `name: string`
- `kind: "knowledge"`
- `summary: string`
- `status: "planned" | "implemented" | "partial"` — distinguishes what exists from what is intended
- `tags: string[]`

**Extraction source:** LLM domain-analyzer agent, from script-produced entry points + file
signatures + directory structure. No additional script work required.

Why: `Domain` → `Feature` is the top-level navigation entry point that PO interviews and
`/grasp-domain` both produce naturally. `Feature` anchors everything — flows, rules, actors,
operations, and code.

#### `Actor`

A user role, user type, or system agent that performs or is restricted from actions.
Examples: "Manager", "Agency User", "Client Contact", "Background Job".

Properties:
- `id: string` — e.g. `actor:manager`
- `name: string`
- `kind: "knowledge"`
- `summary: string`
- `permissions: string[]` — what they can do
- `restrictions: string[]` — what they cannot do
- `tags: string[]`

**Extraction source:** `/grasp-requirements` PO interview only. Scripts produce no actor signals.
Code may hint at roles (guard names, permission constants), but business-level actor
definition requires the PO. Trying to infer actors from code alone would produce
technical roles (e.g. "AdminUser", "AuthGuard") rather than business roles.

Why: PO interviews explicitly produce "who can do X, who is restricted from Y". Without `Actor`,
this knowledge is buried in constraint text and lost for queries.

#### `BusinessRule`

A high-level business policy. Distinct from `Constraint`, which is a precise technical invariant.
A `BusinessRule` describes what is allowed, required, or forbidden at the product level.
Example: "Only managers can approve invoices", "Agency users may not see client contact data".

Properties:
- `id: string` — e.g. `business-rule:manager-approval-only`
- `name: string`
- `kind: "knowledge"`
- `summary: string`
- `ruleText: string` — plain-language statement of the rule
- `status: "active" | "deprecated" | "proposed"`
- `scope: string[]`
- `tags: string[]`

**Extraction source:** Primarily `/grasp-requirements` PO interview. Partially inferrable by the
domain-analyzer LLM from guard/middleware names and permission-checking code patterns
(e.g. `@Roles('MANAGER')`, `if (!user.isAdmin) throw Forbidden`), but semantic intent
requires PO confirmation. Domain-analyzer can produce draft `BusinessRule` nodes; PO
interview promotes them to accepted.

Why: The current schema has `Constraint` (technical invariant with `condition`/`invariant`) and
`Decision` (resolved question with `rationale`). Neither captures high-level business policies well.
`BusinessRule` is the vocabulary product owners use when describing feature governance.

#### `Operation`

A meaningful action the system or a user performs within a feature context. More granular than
`Feature`, more business-meaningful than `Function`. Examples: "Load interview form data",
"Validate assignable users", "Send invitation".

Properties:
- `id: string` — e.g. `operation:send-interview-invitation`
- `name: string`
- `kind: "knowledge"`
- `summary: string`
- `status: "planned" | "implemented" | "partial"`
- `tags: string[]`

**Extraction source:** Both the domain-analyzer LLM (from entry points + exported function
names in the script output) and `/grasp-requirements` PO interview. The scripts surface raw operation
signals deterministically — HTTP endpoints, exported handler names, event handler names —
which the LLM maps to named operations. PO interview adds operations not yet implemented and
clarifies sequencing / constraints. This is the node type with the highest script-to-LLM
signal ratio: a `POST /api/interviews/:id/invite` is already a near-complete operation signal.

Why: The PO interview naturally produces operation sequences — "first this happens, then that,
and only if condition X". `Operation` lets the graph represent ordering, branching, and
parallelism explicitly. It also becomes the bridge from business intent to code implementation.

---

### New Relationships (knowledge graph)

| Type | From | To | Description |
|------|------|----|-------------|
| `:HAS_FEATURE` | `Domain` | `Feature` | Domain owns a feature |
| `:HAS_OPERATION` | `Feature` | `Operation` | Feature contains an operation |
| `:SEQUENCE` | `Operation` | `Operation` | This operation must precede the next |
| `:PERFORMED_BY` | `Operation` | `Actor` | Operation is performed by actor |
| `:RESTRICTED_FOR` | `Operation` | `Actor` | Operation is forbidden for actor |
| `:GOVERNS` | `BusinessRule` | `Feature` / `Operation` | Rule governs feature or operation |
| `:COVERS` | `Feature` | `Flow` | Feature is described by a domain flow |
| `:USES_ENTITY` | `Feature` / `Operation` | `Entity` | Feature/operation works with an entity |

---

### Cross-Graph Bridge

Neo4j does not support relationships that cross separate databases. All nodes — codebase and
knowledge — must live in the **same Neo4j database** for native relationship traversal to work.
Logical separation is maintained by the `kind` property (`"codebase"` vs `"knowledge"`).

Given a single database, add this bridge relationship:

| Type | From (`kind: "knowledge"`) | To (`kind: "codebase"`) | Description |
|------|--------------------------|------------------------|-------------|
| `:IMPLEMENTED_BY` | `Feature` / `Operation` / `BusinessRule` | `File` / `Function` / `Class` | Business concept realized in code |

Properties on this relationship:
- `status: "legacy" | "target" | "shared" | "planned"` — implementation provenance
- `confidence: float` — trust in the mapping

If running two separate Neo4j databases is required (e.g., for access isolation), the bridge
must be maintained at the application layer as a `codebaseIds: string[]` property on knowledge
nodes, and resolved via application-level joins.

This allows queries like:
- "Which files implement the interview invitation feature?"
- "Is this operation still legacy-only or is there a target implementation?"

---

## What to Keep Unchanged

- `Domain`, `Flow`, `Step` — process flow representation, unchanged
- `Decision`, `Constraint`, `Claim` — PO interview output, unchanged and still useful
- `Concept` — abstract concepts, unchanged
- All codebase nodes — completely unchanged
- All existing codebase relationships — unchanged

---

## Rationale for the Distinction: BusinessRule vs Constraint

These are two different vocabularies that show up at different levels of the interview:

- **PO level**: "Managers must approve" — this is a `BusinessRule`, stated as policy
- **Technical level**: "when `approvalRequired` is true, `status` must not advance without
  `approvedBy` being set" — this is a `Constraint`, stated as an invariant

Both are real. Merging them forces either imprecision at the technical level or over-engineering
at the business level. Keeping them separate means the graph can answer both
"what are the rules?" (business) and "what must always be true?" (technical).

---

## Rationale for Actor

The entire premise of the PO interview in `/grasp-requirements` is to extract "who can do what, who is
restricted from what, what processes run in which context to achieve which goal." Without `Actor`
as a first-class node, the answer to "who" is scattered across constraint text and summaries,
and is not queryable.

`Actor` also enables the most common PO-interview patterns:
- "Only [actor] can perform [operation]" → `PERFORMED_BY`
- "[actor] may not see/do [operation]" → `RESTRICTED_FOR`
- "When [actor] does X, rule R applies" → `Actor` + `BusinessRule` + `GOVERNS`

---

## Rationale for Feature

Currently `Domain` connects directly to `Flow`. This works for process documentation but loses
the product concept of a "feature" — a named, versioned, deliverable slice of product behavior.

`Feature` is the correct anchor because:
- It is what PO interviews produce ("we are adding the Interview Scheduling feature")
- It is what tickets and tasks reference
- It connects to flows (process), operations (actions), rules (governance), and code (implementation)
- It carries `status: planned | implemented | partial` — the key split between what the PO
  envisions and what the codebase currently does

---

## Token Cost Summary

| Node | Script provides | LLM required | Skill that creates it |
|------|----------------|--------------|----------------------|
| `Feature` | URL paths, dir names, controller names | Yes — semantic grouping | `/grasp-domain` (domain-analyzer) |
| `Actor` | Nothing reliable | Yes — business role definition | `/grasp-requirements` only |
| `BusinessRule` | Guard/permission patterns (draft) | Yes — semantic intent + PO confirmation | `/grasp-domain` draft, `/grasp-requirements` accepted |
| `Operation` | HTTP endpoints, exported handler names | Yes — business naming + sequencing | `/grasp-domain` + `/grasp-requirements` |
| `Domain` | Entry point groupings (existing) | Yes (existing) | `/grasp-domain` (existing) |
| `Flow` / `Step` | Nothing | Yes (existing) | `/grasp-domain` (existing) |
| `Decision` / `Constraint` / `Claim` | Nothing | Yes (existing) | `/grasp-requirements` (existing) |
| `File`, `Function`, `Class` | Full structural facts | Yes — summaries only | `/grasp` (existing) |

**Key principle:** Scripts run once at zero LLM cost, produce deterministic facts, and reduce
the context the LLM needs to read. The LLM never has to rediscover what the script already
knows. Adding new graph nodes does not add new LLM passes — `Feature`, `Operation`, and draft
`BusinessRule` can all be extracted in the same domain-analyzer invocation that currently
produces `Domain` / `Flow` / `Step`, from the same script output it already reads.

---

## Groovy and Grails Support

The primary target codebase is a Grails application (Groovy + Java). Neither language is
currently fully supported. Java has partial support (tree-sitter grammar, import resolver,
Spring framework config); Groovy has **no support at all** — files are invisible to every
script in the pipeline.

### Current state of Java support

Java is partially wired:
- `tree-sitter-java` WASM grammar is in `builtinLanguageConfigs`
- Import resolver in `extract-import-map.mjs` handles dotted FQN → file path
- Spring framework config detects Spring Boot (via `pom.xml` / `build.gradle` keywords)
- **Gap:** Spring framework config lists only `["java", "kotlin"]` — not `"groovy"`
- **Gap:** `extract-domain-context.py` entry point patterns do not include Spring/Grails
  annotation patterns (`@GetMapping`, `@PostMapping`, `@RequestMapping`, Grails action methods)

### Why Groovy is completely absent

`tree-sitter-groovy` exists on npm and **ships a `.wasm` file** (`tree-sitter-groovy.wasm`) —
confirmed by inspection. This means full tree-sitter support can be added, not just a regex
fallback.

The gaps:

1. No `groovy.ts` language config → `builtinLanguageConfigs` does not include Groovy
2. No `.groovy` / `.gsp` in `SOURCE_EXTENSIONS` in `extract-domain-context.py` → files are
   never discovered or scanned
3. No Grails entry point patterns in `ENTRY_POINT_PATTERNS` → controller actions and service
   methods produce no entry point signals
4. No Groovy import resolver in `extract-import-map.mjs` → zero import edges
5. No Grails framework config → layer hints, entry point globs, architecture detection absent
6. Spring framework config excludes `"groovy"` → Spring annotations in `.groovy` files ignored

### Implementation tasks

#### Task G1 — `groovy.ts` language config

Create `grasp-it-plugin/packages/core/src/languages/configs/groovy.ts`:

```typescript
export const groovyConfig = {
  id: "groovy",
  displayName: "Groovy",
  extensions: [".groovy", ".gvy", ".gy", ".gsh"],
  treeSitter: {
    wasmPackage: "tree-sitter-groovy",
    wasmFile: "tree-sitter-groovy.wasm",
  },
  concepts: [
    "closures",
    "dynamic typing",
    "GDK extensions",
    "traits",
    "AST transformations",
    "builders",
    "metaprogramming",
    "GORM",
    "dependency injection",
    "annotations",
  ],
  filePatterns: {
    entryPoints: [
      "grails-app/controllers/**/*Controller.groovy",
      "grails-app/services/**/*Service.groovy",
      "grails-app/jobs/**/*Job.groovy",
    ],
    barrels: [],
    tests: ["*Spec.groovy", "*Test.groovy", "*Tests.groovy", "*IT.groovy"],
    config: ["build.gradle", "grails-app/conf/application.yml",
             "grails-app/conf/application.groovy"],
  },
} satisfies LanguageConfig;
```

Register it in `configs/index.ts` alongside `javaConfig`.

Add `tree-sitter-groovy` as a dependency in `packages/core/package.json`.

#### Task G2 — Groovy import resolver in `extract-import-map.mjs`

Groovy uses the same dotted-package import style as Java:

```groovy
import com.example.offer.InterviewService
import grails.gorm.transactions.Transactional
```

Add a `resolveGroovyImport` function that reuses the existing `resolveDottedFqn` helper (same
logic as `resolveJavaImport`), but probes `.groovy` files via a pre-built `groovyIndex` suffix
index. Add `"groovy"` to the dispatcher in `resolveImport`.

Note: Groovy files often import Java classes from the same project. The resolver should probe
`.groovy` first, then fall back to `.java` for cross-language project-internal imports
(common in mixed Grails/Java projects).

#### Task G3 — GSP file support

Grails Server Pages (`.gsp`) are server-rendered views. They are not code files but contain
controller references and tag library calls that reveal business flows.

Add `.gsp` to `SOURCE_EXTENSIONS` in `extract-domain-context.py`.

Add a non-code `gsp.ts` config (similar to `html.ts`) so `.gsp` files are classified and
processed by the file-analyzer as view artifacts.

#### Task G4 — Grails entry point patterns in `extract-domain-context.py`

Add to `SOURCE_EXTENSIONS`:
```python
".groovy", ".gvy",
```

Add to `ENTRY_POINT_PATTERNS`:

```python
# Grails controller actions (public methods in *Controller.groovy)
("http", "Grails controller action", re.compile(
    r"""def\s+(\w+)\s*\("""
    # Only trigger in controller files — filtered by file path check
)),
# Spring/Grails HTTP mapping annotations
("http", "Spring mapping annotation", re.compile(
    r"""@(?:GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*\(\s*['"](/[^'"]*?)['"]""",
    re.IGNORECASE,
)),
# Grails URL mappings DSL
("http", "Grails URL mapping", re.compile(
    r""""(/[^"]+)"\s*\{"""
)),
# Grails jobs (scheduled tasks)
("cron", "Grails job", re.compile(
    r"""static\s+triggers\s*=\s*\{"""
)),
# Grails service transactional methods
("manual", "Grails service method", re.compile(
    r"""@Transactional.*\n\s*(?:def|void|\w+)\s+(\w+)\s*\("""
)),
```

Also extend the `priority_keywords` list in `extract_file_signatures` with Grails-specific
naming conventions:
```python
"controller", "service", "domain", "command", "taglib", "job", "interceptor",
```
(Some are already present; `domain`, `taglib`, `interceptor` are Grails-specific.)

#### Task G5 — Grails framework config

Create `grasp-it-plugin/packages/core/src/languages/frameworks/grails.ts`:

```typescript
export const grailsConfig = {
  id: "grails",
  displayName: "Grails",
  languages: ["groovy", "java"],
  detectionKeywords: [
    "grails",
    "org.grails",
    "grails-core",
    "gorm",
  ],
  manifestFiles: ["build.gradle", "grails-app/conf/application.yml"],
  promptSnippetPath: "./frameworks/grails.md",
  entryPoints: [
    "grails-app/controllers/**/*Controller.groovy",
    "grails-app/init/*Application.groovy",
  ],
  layerHints: {
    controller: "api",
    service: "service",
    domain: "data",
    repository: "data",
    job: "service",
    taglib: "ui",
    interceptor: "middleware",
    conf: "config",
    command: "types",
    dto: "types",
  },
} satisfies FrameworkConfig;
```

Register in `frameworks/index.ts`.

#### Task G6 — Extend Spring framework config for Groovy

In `spring.ts`, change:
```typescript
languages: ["java", "kotlin"],
```
to:
```typescript
languages: ["java", "kotlin", "groovy"],
```

### Expected outcome after all tasks

| Script | Before | After |
|--------|--------|-------|
| `extract-domain-context.py` file discovery | Skips all `.groovy` / `.gsp` | Scans all Groovy source and view files |
| `extract-domain-context.py` entry points | Zero Grails signals | Controller actions, Spring mappings, URL mappings, jobs |
| `extract-structure.mjs` | Line counts only | Functions, classes, exports, call graph via tree-sitter |
| `extract-import-map.mjs` | Zero edges from Groovy files | Full inter-file import edges, cross-language Java↔Groovy edges |
| Framework detection | Spring only matches Java | Grails framework detected, layer hints applied |
| LLM domain-analyzer input | Blind to Grails structure | Full entry point + signature context for domain/feature extraction |

### Dependency to add

```
tree-sitter-groovy   (ships tree-sitter-groovy.wasm — confirmed)
```

---

## Summary of Changes

### Schema changes

| Change | Type | Status |
|--------|------|--------|
| Add `Feature` node | New knowledge node | ✅ Final |
| Add `Actor` node | New knowledge node | ✅ Final |
| Add `BusinessRule` node | New knowledge node | ✅ Final |
| Add `Operation` node | New knowledge node | ✅ Final |
| Add `Entity` node | New knowledge node | ✅ Final |
| Drop `Flow` + `Step` nodes | Removed (redundant with `Operation + SEQUENCE`) | ✅ Final |
| Add `HAS_FEATURE` | New relationship | ✅ Final |
| Add `HAS_OPERATION` | New relationship | ✅ Final |
| Add `SEQUENCE` | New relationship | ✅ Final |
| Add `PERFORMED_BY` | New relationship | ✅ Final |
| Add `RESTRICTED_FOR` | New relationship | ✅ Final |
| Add `GOVERNS` | New relationship | ✅ Final |
| Add `USES_ENTITY` | New relationship | ✅ Final |
| Add `CONSTRAINED_BY` (extended to Feature/BusinessRule) | Relationship extension | ✅ Final |
| Add `DECIDES` (Decision → Feature/BusinessRule) | New relationship | ✅ Final |
| Add `IMPLEMENTED_BY` | Native bridge relationship | ✅ Final (requires single DB) |
| Drop `CONTAINS_FLOW`, `FLOW_STEP`, `CROSS_DOMAIN` | Removed with Flow/Step | ✅ Final |
| Single database, `kind` property separation | Architecture decision | ✅ Final |

### Groovy / Grails support (G1–G6)

| Task | Change | Status |
|------|--------|--------|
| **G1** | `groovy.ts` language config + `tree-sitter-groovy` dep | 🔲 To implement |
| **G2** | Groovy import resolver in `extract-import-map.mjs` (dotted FQN + Java fallback) | 🔲 To implement |
| **G3** | GSP file support (`gsp.ts` config + add `.gsp` to Python script) | 🔲 To implement |
| **G4** | Grails entry point patterns in `extract-domain-context.py` (controller actions, mappings, URL DSL, jobs) | 🔲 To implement |
| **G5** | Grails framework config (`grails.ts`) with layer hints | 🔲 To implement |
| **G6** | Add `"groovy"` to Spring framework config languages | 🔲 To implement |
