---
name: grasp-gaps
description: Use when the user wants to add missing knowledge to the configured Neo4j graph after an investigation or for a named topic, for example `/grasp-gaps notification settings`. The main agent may pass conclusions or evidence hints, but a smaller sub-agent must verify the current graph state itself, determine the real gap, and produce a dated incremental Cypher refresh artifact.
allowed-tools: Bash
---

# Graph Cover Gaps Skill

Use this skill to convert investigation results or a focused topic into a graph knowledge refresh for the Neo4j database configured in the project `.env`.

This skill is for **graph maintenance after reasoning**, not for broad initial investigation.
The main agent may already know a lot.
That context is useful, but it is only advisory input for the delegated graph-maintenance pass.

## When to use

- after an investigation, when the chat uncovered business rules, risks, contexts, operations, or implementation evidence that the graph likely does not capture yet
- when the user gives a focused topic and wants the graph enriched for it, for example `/grasp-gaps notification settings`
- when the user wants the main agent to keep the higher-level reasoning while a smaller sub-agent performs graph inspection and refresh writing

## Core contract

The skill runs in the **main agent**, but the graph-gap work is always delegated.

The main agent should:

- prepare a compact brief for the delegated pass
- include the topic
- include any relevant conclusions from the current chat
- include evidence hints such as likely files, operations, or risks if already known
- include the current best-known graph line, neighborhood, and existing node/context keys when those are already known from prior work

The delegated sub-agent must still do its own work:

- load `.env` itself
- connect to the configured Neo4j database itself
- sanity-check the provided graph line or determine it only if the main agent could not already narrow it
- inspect what already exists for the topic
- reconcile that with the main-agent brief
- decide what is actually missing
- produce a dated incremental `.cypher` refresh artifact

Do not treat the main-agent brief as authoritative truth.
Treat it as a strong hint that narrows the delegated pass.

Bias toward omission over overreach:

- if the main-agent brief names a suspected gap slice, verify that slice first
- prefer leaving a possible gap untouched over spending substantial time proving whether it might also be missing
- after confirming one coherent missing slice, freeze scope and write the smallest useful artifact
- do not keep expanding into adjacent gaps unless that is required to attach the new nodes correctly
- if the main agent already knows the configured graph line or existing local node names, reuse that information instead of rediscovering it through repo searches

## Delegation profile

Always spawn a sub-agent for the graph-gap pass.

Spawn the sub-agent in non-blocking mode.
Do not wait immediately after spawning.
Only call `wait_agent(...)` when the delegated result is actually needed for the final wrap-up.

Default delegated profile:

- model: `gpt-5.4-mini`
- reasoning: `medium`

Escalate only when needed:

- keep the same model and raise reasoning to `high` when the topic spans multiple graph neighborhoods, the graph shape is ambiguous, or the docs and live data do not line up cleanly

Do not use the full main-agent model for routine graph refresh writing unless the user explicitly asks for it.

Do not spend extra reasoning budget on exhaustive absence checks.
For routine refreshes, the delegated pass should confirm a narrow gap and write the artifact quickly.

## Runtime prerequisites

Credentials are in the project `.env` file:

- `NEO4J_URI`
- `NEO4J_DATABASE`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`

Load them with shell sourcing:

```bash
set -a
source .env >/dev/null 2>&1
set +a
```

Check Java first:

```bash
java -version
```

- If Java 21 is available locally, prefer using Java 21 for `cypher-shell` before the first live graph query in the delegated pass.
- If only an older or different Java is active, try to locate a Java 21 installation before the first live query.
- If Java 21 is not available, try the query once with the available Java and only switch if `cypher-shell` reports a Java/runtime compatibility error.
- Do not change Java for unrelated Gradle work in this repository. This Java preference is for Neo4j CLI usage only.
- Request escalation proactively before the first live Neo4j `cypher-shell` query so the delegated pass does not fail on its first graph read.
- If graph access still fails with connection or permission errors, rerun the same `cypher-shell` command with the required approval instead of changing the workflow.

Useful `cypher-shell` reminders for this skill:

- prefer `--format plain` for scripting-oriented inspection output
- pass one inline query for short checks
- use `-f <file>.cypher` when you want to validate or apply a saved artifact
- keep read queries and write artifacts separate so it is obvious what inspected state and what changed it

## Step 1 - Sub-agent graph discovery

The configured graph is the one from `.env`.
Do not hardcode graph paths up front.

Start with a small health check:

```bash
java -version
set -a
source .env >/dev/null 2>&1
set +a
cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" \
  "MATCH (n) RETURN labels(n)[0] AS label LIMIT 10;"
```

Then inspect the live schema shape:

```bash
set -a
source .env >/dev/null 2>&1
set +a
cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format plain "
MATCH (n)
UNWIND labels(n) AS label
RETURN DISTINCT label
ORDER BY label;
"
```

Use the label families to determine the graph shape.

The simplified Neo4j schema uses two label groups:

**Codebase nodes** (structure and implementation):

- `File` - source file or module
- `Function` - function or method
- `Class` - class or struct
- `Module` - module or package
- `Concept` - code-level concept
- `Config` - configuration entity
- `Service` - service component
- `Table` - database table
- `Endpoint` - API endpoint
- `Pipeline` - data or build pipeline
- `Schema` - schema definition
- `Resource` - external resource

**Knowledge nodes** (business and domain):

- `Domain` - business domain
- `Feature` - workflow or process
- `Operation` - workflow step
- `Actor` - person or role that performs operations
- `BusinessRule` - business rule or policy
- `Article` - documentation or article
- `Entity` - domain entity
- `Topic` - topic or subject
- `Claim` - assertion or claim
- `Source` - source of information
- `Decision` - decision record
- `Constraint` - constraint or rule

**Key relationships**:

```
Domain -[:HAS_FEATURE]-> Feature
Feature -[:HAS_OPERATION]-> Operation
Operation -[:PERFORMED_BY]-> Actor
Feature -[:GOVERNED_BY]-> BusinessRule
Entity -[:RELATED_TO]-> Entity
Concept -[:DEFINED_IN]-> File
Function -[:PART_OF]-> Class
Endpoint -[:CALLS]-> Service
```

Read only the files needed to determine:

- the canonical node types
- relationship directions
- expected metadata fields
- artifact storage location

If the main agent already provides the likely graph line and update folder:

- treat that as the default working assumption
- perform at most one live sanity-check query before proceeding

## Step 2 - Build the delegated brief

The main agent should pass the sub-agent a compact prompt that includes:

- the topic to cover
- the relevant conclusions from the current investigation
- any likely files, operations, entities, rules, risks, or contexts already surfaced in the chat
- any specific suspicion about what is missing, if known
- any explicit exclusions, if the main agent already knows which adjacent topics should not be explored
- any known existing node keys, context keys, or operation keys that should be reused rather than rediscovered

When the main agent already has concrete suspected gaps, use bounded refresh mode:

- list the exact facts to verify
- tell the sub-agent to patch only those facts if they are absent
- explicitly say which nearby topics are out of scope
- prefer a smaller artifact that may omit some possible gaps over a broader artifact that requires more discovery
- if the main agent already knows the graph line or neighborhood keys, tell the sub-agent to sanity-check them once and continue rather than searching for alternatives

Example brief shape:

```text
Topic: notification settings

Advisory context from current investigation:
- interview invitation delivery uses NEW_INTERVIEW notification handling
- client-side recipients may receive defaults that are not visible in settings
- likely evidence is in UserNotificationsService, NotificationType, mapper/UI settings files

Your task:
1. verify the configured graph and matching docs from .env plus repo files
2. inspect current graph coverage for this topic
3. determine what is actually missing
4. write one dated incremental refresh artifact in .grasp-it/graph-updates/
5. summarize what existed, what gap you found, and what you added
```

## Step 3 - Inspect current graph coverage

The delegated sub-agent should always verify the current graph before drafting an update artifact.

Use the narrowest verification that can confirm or reject the suspected gap.
Do not broaden to neighboring topics unless the first targeted checks show the brief was materially wrong.
Do not use repo docs, generation logs, or update files as substitutes for proving graph absence; use them only for artifact shape after the gap is already confirmed.

Start broad with the topic terms, using `kind` filtering for the appropriate node type:

```cypher
WITH ['notification settings', 'notification', 'settings'] AS terms
MATCH (seed)
WHERE any(t IN terms WHERE
  toLower(coalesce(seed.name, '')) CONTAINS t
  OR toLower(coalesce(seed.summary, '')) CONTAINS t
  OR toLower(coalesce(seed.key, '')) CONTAINS t)
RETURN labels(seed)[0] AS type,
       seed.key AS key,
       seed.name AS name,
       seed.summary AS summary,
       seed.kind AS kind
ORDER BY type, name
LIMIT 100;
```

Use `kind` property filtering to narrow to specific node types when the topic is known:

```cypher
WITH ['notification settings'] AS terms
MATCH (seed)
WHERE seed.kind IN ['Domain', 'Feature', 'Entity', 'Concept']
  AND any(t IN terms WHERE
    toLower(coalesce(seed.name, '')) CONTAINS t
    OR toLower(coalesce(seed.summary, '')) CONTAINS t)
RETURN labels(seed)[0] AS type,
       seed.key AS key,
       seed.name AS name,
       seed.kind AS kind,
       seed.summary AS summary
ORDER BY type, name
LIMIT 50;
```

Then inspect the closest connected neighborhood for the most relevant nodes:

```cypher
MATCH (seed)
WHERE seed.key IN ['replace-with-candidate-keys']
OPTIONAL MATCH (seed)-[r]-(n)
RETURN labels(seed)[0] AS seedType,
       seed.name AS seedName,
       seed.kind AS kind,
       type(r) AS relation,
       labels(n)[0] AS neighborType,
       n.name AS neighborName
ORDER BY seedType, seedName, relation, neighborType, neighborName;
```

When the main-agent brief already names likely operations or features, verify them explicitly rather than guessing from memory.

The gap decision should be based on both:

- what the graph already contains
- what the current investigation established

Stop rule for coverage inspection:

- after two targeted live-graph checks and enough repo evidence to support one coherent artifact, stop investigating and move to artifact writing
- if the targeted slice already exists, report that result and stop instead of searching for a replacement gap
- if multiple possible gaps remain, choose the smallest confirmed one and leave the others for a separate request
- once the stop rule is reached, do not continue with repo-side naming archaeology; if the existing key names are still unclear, report that uncertainty and stop rather than guessing

## Step 4 - Decide what should be added

Prefer the smallest useful refresh.
Do not reseed the whole topic when only one missing slice was discovered.

Default to one coherent missing slice per run.
It is better to leave a possible extra gap for a later request than to widen the current artifact through uncertain reasoning.

Good additions usually include some combination of:

- one missing `Domain` or `Feature`
- missing `Operation` nodes
- missing `Entity`, `Concept`, or `Constraint` nodes
- missing implementation or evidence links
- refreshed metadata on stale nodes that are still the right nodes

Avoid:

- renaming large parts of the graph unless the docs or live graph clearly require it
- duplicating conceptually identical nodes under new keys
- adding technical nodes without the business nodes that justify them
- expanding scope just because related concepts also look interesting or possibly incomplete
- continuing to probe for everything that might be missing after one useful patch is already confirmed

Before writing, freeze scope in one short internal statement:

- what exact gap is being patched
- what nearby gaps are intentionally left out
- which existing graph line, update folder, and neighborhood keys are being reused

## Step 5 - Write the artifact

Artifact mode is required for this skill.

Write one dated incremental `.cypher` file in `.grasp-it/graph-updates/`.

Naming guidance:

- use ISO date prefix
- use a short topic slug
- prefer `...-refresh.cypher` when enriching existing coverage
- prefer `...-seed.cypher` only when the graph docs and live state clearly indicate first-pass seeding for that slice

Example shape:

- `.grasp-it/graph-updates/2026-05-12-notification-settings-refresh.cypher`

### Cypher writing rules

- prefer `MERGE` by stable `key` for business nodes
- use `SET` to refresh metadata fields and summaries
- include `kind` property for filtering
- follow relationship directions from the graph schema
- keep the artifact idempotent
- keep provenance and freshness metadata explicit

Recommended metadata values:

- `generatedAt`
- `status`
- `sourceCommit` when available
- `evidencePaths`
- `kind` for node type filtering

Generic pattern:

```cypher
WITH
  '2026-05-12T12:00:00+02:00' AS generatedAt,
  'optional-commit-sha' AS sourceCommit
MERGE (n:Domain {key: 'stable.key'})
SET n.name = 'Human Name',
    n.summary = 'Short factual summary.',
    n.kind = 'Domain',
    n.generatedAt = generatedAt,
    n.sourceCommit = sourceCommit,
    n.status = 'active',
    n.evidencePaths = [
      'path/one',
      'path/two'
    ]
```

Generic relationship pattern:

```cypher
MATCH (a:Domain {key: 'a.key'}),
      (b:Feature {key: 'b.key'})
MERGE (a)-[:HAS_FEATURE]->(b);
```

When updating existing knowledge, prefer augmenting the right nodes over replacing them with new ones.

## Step 6 - Verification

After writing the artifact, run verification queries against the live graph shape so the summary is grounded.

Minimum verification:

- the newly added keys resolve
- the intended relationships exist
- the new slice is connected to the expected neighborhood

Example verification query:

```cypher
MATCH (n)
WHERE n.key IN [
  'replace.new.key.one',
  'replace.new.key.two'
]
OPTIONAL MATCH (n)-[r]-(m)
RETURN n.key AS key,
       labels(n)[0] AS type,
       n.kind AS kind,
       n.name AS name,
       collect(DISTINCT [type(r), labels(m)[0], m.key, m.name]) AS neighbors
ORDER BY key;
```

## Expected delegated output

The sub-agent should return:

- the artifact path it wrote
- what already existed for the topic
- what gap it determined
- what it added or refreshed
- any uncertainty or follow-up gaps it deliberately left out

Keep that summary short and concrete.

## Main-agent wrap-up

After the delegated pass completes, the main agent should:

- quickly review the artifact for obvious duplication or direction mistakes
- report the created artifact path
- summarize the intended graph addition in plain language

Do not claim the graph was updated live unless the user separately asked to apply the artifact.