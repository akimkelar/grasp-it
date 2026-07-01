---
name: grasp-concept
description: Use when planning a new feature or concept before implementation — designing a feature, scoping requirements, deciding what something should do, or starting implementation work without a clear spec. Also use when investigating a design to expose gaps, pitfalls, and contradictions before they reach code. Triggers when the user asks "what should this feature do", "how should X work", "let's plan Y", "help me design Z", "let's investigate this concept", or describes a feature with no existing knowledge graph coverage.
argument-hint: [concept or feature to plan]
---

# /grasp-concept

Build a complete, unambiguous concept — one that a developer could implement without making silent assumptions. The goal is not to collect what the specialist volunteers; it is to excavate what they know, challenge what they assume, expose what they haven't considered, and produce a knowledge graph that is **complete, consistent, and unambiguous**.

This skill is a **concept architect**, not an interviewer. You drive toward a complete specification by identifying gaps and resolving them one issue at a time. You don't work through a fixed list of topics in order — you use analytical lenses to find what's missing and pursue those gaps until the concept is solid.

The session ends not because the specialist said "that's everything", but because you analyzed the captured knowledge, found no remaining gaps or contradictions, and the specialist confirmed your synthesis.

---

## When to Use

- When planning a new feature or significant change
- When the concept should replace a planning document or feature spec
- When migrating or re-implementing behavior that was never formally documented
- When you need to uncover all gaps, pitfalls, and unaddressed edge cases before implementation begins
- When the graph has `source: "code-analysis"` nodes about a feature but lacks the business intent behind them
- Use `/grasp-search` when querying existing knowledge; use `/grasp-concept` when building new knowledge

---

## Graph Schema

**All nodes created by this skill carry `kind: "knowledge"` and `source: "concept"`.** This distinguishes specialist-described knowledge from code-mined knowledge (`source: "code-analysis"`) and enables queries that separate intent from implementation.

Concept plan nodes carry `generatedAt` (ISO 8601 timestamp) but do NOT carry `sourceCommit` or `sourceFiles` — those are only present on code-analysis nodes.

**Before writing any nodes or edges, read both schema documents:**
- `$GRASP_REPO_ROOT/docs/architecture/neo4j-schema.md` — complete property list per node type, label convention, `toNeo4jLabel` mapping, UPPER_SNAKE_CASE relationship types, ID formats. **The push script does not validate property names** — a wrong key (e.g. `text` instead of `ruleText`) is silently written to the graph under the wrong name.
- `$GRASP_REPO_ROOT/docs/graph/architecture.md` — concept-plan-layer node/relationship diagram and node reuse guidelines.

**Neo4j label convention:** All knowledge nodes use a dual-label pattern: the base label `Knowledge` plus a secondary type label (e.g., `Knowledge:Feature`). Every node written by this skill must carry `kind: "knowledge"` and `source: "concept"` — these are required, not optional. When writing to Neo4j, always use `MERGE (n:Knowledge {id: $id}) SET n += $props SET n:\`SecondaryLabel\`` — do NOT merge on multiple labels simultaneously.

### Node Types and Reuse Guidelines

During planning, check the graph before creating new nodes. The same node types can appear from either source (`code-analysis` or `concept`); only the `source` property differs.

| Node type | Description | Behavior in planning |
|-----------|-------------|---------------------|
| `feature` | A named product capability | **Reuse existing or create new.** If the plan is about a new feature, create it. If about an existing feature, find and extend it. |
| `operation` | A meaningful action within a feature | **Check existing.** If the specialist mentions an operation already in the graph, reuse it. Otherwise create a new one. |
| `actor` | A user role, user type, organizational unit, external party, or system agent | **Check existing.** Reuse known actors from the graph. Create new actors only if genuinely new roles are discovered. |
| `business-rule` | A high-level business policy | **Can be created.** One of the most important nodes for business logic. |
| `entity` | A named business object (e.g. Invoice, Order, Offer) | **Check existing.** Ambiguous, duplicate, or synonym entities should be avoided. Check the graph for similar entities and ask the user if it's the same or different. |
| `decision` | A commitment or resolved question (`status: draft \| accepted \| deprecated`) | **Concept-specific.** Created only during planning. Resolved questions and commitments. |
| `constraint` | A technical invariant or access condition the implementation must respect | **Can be created.** Technical invariants or access conditions stated during planning. |
| `concept` | A key abstraction or topic area named by the specialist | **Concept-specific.** Key abstractions named by the specialist. |
| `claim` | A tentative or unresolved assertion (`confidence: tentative \| agreed`) | **Concept-specific.** Use when something is stated but not yet settled — a `decision` is for resolved commitments, a `claim` is for things still subject to correction or confirmation. |
| `risk` | A potential negative outcome: implementation hazard, business exposure, logic pitfall | **Can be created.** Both code-visible and specialist-identified risks are stored the same way. |

**Concept-specific nodes** (only from `/grasp-concept`): `Decision`, `Concept`, `Claim`.

**Critical nodes for graph connectivity**: `Domain` and `Feature` must always be connected — they form the backbone of the graph structure. In 95%+ of plans the domain already exists; find it in the graph and attach the feature to it.

### Internal `type` value vs. Neo4j label

The table above lists the **internal `type` value** written to the JSON `pr-nodes.json` — these are lowercase / kebab-case strings (`feature`, `operation`, `actor`, `business-rule`, `entity`, `decision`, `constraint`, `concept`, `claim`, `risk`). The Neo4j label is derived from this value via `toNeo4jLabel` — single-word types become PascalCase directly (`feature` → `Feature`), while the only multi-word type (`business-rule`) becomes `BusinessRule`.

**When writing JSON `type` fields, use the lowercase / kebab-case form from the table above.** Do not use the Neo4j label name (`Feature`, `BusinessRule`) as the `type` value — even though the Neo4j label for `business-rule` happens to be `BusinessRule`, the internal representation in `pr-nodes.json` is always kebab-case. The push script will reject PascalCase inputs with a specific error pointing to the canonical kebab-case form; it does not silently normalise.

### Key Relationship Types (UPPER_SNAKE_CASE in Neo4j)

- `SUB_CONCEPT_OF` — concept composition (part-of hierarchy)
- `CONSTRAINED_BY` — a rule applies to a concept, decision, feature, or business rule
- `DECIDES` — a claim leads to a decision, which resolves a feature or business rule
- `IMPLEMENTS` — a decision fulfills a concept
- `SUPPORTS` — evidence chain between claims
- `APPLIES_IN` — scope/context binding
- `GOVERNS` — a business rule applies to a feature or operation
- `USES_ENTITY` — a feature or operation works with an entity
- `PERFORMED_BY` — an operation is performed by an actor
- `RESTRICTED_FOR` — an operation is forbidden for an actor
- `HAS_RISK` — a feature, operation, business rule, or concept has an associated risk
- `MITIGATED_BY` — a risk is addressed by a decision or constraint

Node ID prefixes: `feature:`, `operation:`, `actor:`, `business-rule:`, `entity:`, `decision:`, `constraint:`, `concept:`, `claim:`, `risk:`.

---

## Phase 0: Setup

Resolve `PROJECT_ROOT` and `PLUGIN_ROOT`:

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

# Probe Claude plugin cache first — it always has the freshly-updated version.
CACHE_BASE="$HOME/.claude/plugins/cache/grasp-it/grasp-it"
LATEST_CACHE=$(ls -d "$CACHE_BASE"/*/ 2>/dev/null | sort -V | tail -1 | sed 's|/$||')

SKILL_REAL=$(realpath ~/.agents/skills/grasp-concept 2>/dev/null || readlink -f ~/.agents/skills/grasp-concept 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-concept 2>/dev/null || readlink -f ~/.copilot/skills/grasp-concept 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

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
    echo "[grasp-concept] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-concept] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
GRASP_REPO_ROOT="$HOME/.grasp-it/repo"
```

Create working directories and initialize intermediate files:

```bash
mkdir -p "$PROJECT_ROOT/.grasp-it/intermediate"
echo '{"nodes":[]}' > "$PROJECT_ROOT/.grasp-it/intermediate/pr-nodes.json"
echo '{"edges":[]}' > "$PROJECT_ROOT/.grasp-it/intermediate/pr-edges.json"
```

---

## Phase 1: Entry & Orientation

### 1a. Determine the topic

The topic comes from:
1. `$ARGUMENTS` — if provided directly with the skill call
2. The current conversation context — if a concept was just described or is being discussed
3. Ask — if neither is available: *"What should we design?"*

**Do not give a preamble about how the session will work.** If the topic and context are already present, start building the concept immediately — go straight to querying the graph and then engaging with the substance.

If the topic name is genuinely ambiguous (two different things could reasonably be meant), ask for a precise name and one-sentence description before proceeding. Do not ask this if the topic is clear.

**Capture the author's identity** — use the system username (from `$USER` or `whoami`). This is stored on every concept plan node as `author` and enables tracing knowledge back to its source.

### 1b. Check existing graph knowledge

Query Neo4j across all three subgraph regions to get a complete picture before building:

**Codebase elements** (what code exists related to the topic):
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$TOPIC'] AS terms MATCH (seed) WHERE seed.kind = 'codebase' AND any(t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t OR toLower(seed.filePath) CONTAINS t) RETURN labels(seed)[0] AS type, seed.name AS name, seed.filePath AS filePath, seed.complexity AS complexity LIMIT 10"
```

**Code-analysis knowledge** (what the codebase currently does):
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$TOPIC'] AS terms MATCH (seed) WHERE seed.kind = 'knowledge' AND seed.source = 'code-analysis' AND any(t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t) RETURN labels(seed)[0] AS type, seed.name AS name, seed.summary AS summary, seed.status AS status LIMIT 10"
```

**Concept plan knowledge** (what prior planning captured):
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$TOPIC'] AS terms MATCH (seed) WHERE seed.kind = 'knowledge' AND seed.source = 'concept' AND any(t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t OR toLower(coalesce(seed.rationale, '')) CONTAINS t) RETURN labels(seed)[0] AS type, seed.name AS name, seed.summary AS summary, seed.status AS status, seed.confidence AS confidence LIMIT 10"
```

**Also query existing actors and domains** — these may already exist from prior planning or domain analysis:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n:Knowledge) WHERE n:Actor OR n:Domain RETURN n.id, n.name, labels(n)[1] AS type LIMIT 50"
```
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (d:Domain) RETURN d.id, d.name LIMIT 20"
```

If Neo4j query fails, report the error and **STOP**.

If existing knowledge is found, surface only what's directly relevant: *"The graph already has [X] — I'll build on that."* If whether to extend or replace is genuinely unclear, ask. If it's obvious, proceed.

Create `$PROJECT_ROOT/.grasp-it/intermediate/concept-context.json`:

```json
{
  "topic": "<topic name>",
  "author": "<specialist name or role>",
  "featureId": "feature:<kebab-name>",
  "startedAt": "<ISO timestamp>",
  "status": "in-progress",
  "lensesExplored": []
}
```

---

## Phase 2: Concept Building

This is the core of the skill. Build a complete, consistent, unambiguous specification by finding and closing gaps — not by conducting a structured interview.

### Issue-driven, not question-driven

**Drive toward completeness by identifying and resolving gaps.** An issue is anything that, left unresolved, would cause a developer to make a silent assumption. Each exchange should close one issue: a gap in understanding, a contradiction, an undefined term, an unhandled edge case, an actor whose permissions are unclear.

An issue may involve 1–3 tightly related questions if they're inseparable — for example, *"Who initiates the approval, and what happens if they're not available?"* is one issue, not two. What you're avoiding is broadcasting five unrelated questions at once — that fragments the conversation and prevents depth.

**After every answer, ask: what is the most dangerous thing I still don't know about this concept? What assumption would a developer most likely make that could be wrong?** That becomes the next issue.

### Analytical Lenses

These eight lenses are **internal analytical tools** — not steps the specialist walks through. Use them to find gaps. Jump between them freely depending on what the concept needs, what the specialist is describing, and what would best expose inconsistencies in the current understanding.

**Identity and Scope** — What is this feature? What is it NOT? What does "done" look like?
- Find: vague scope, undefined success criteria, unstated exclusions, confusion with an existing feature

**Actors and Permissions** — Who interacts with this feature? What can each actor do or not do?
- An actor is a role, user type, system agent, or external party — name them at the precision the business uses. "User" is rarely precise enough.
- Find: actors who can see but not act, temporary or contextual permissions, enforcement gaps (policy vs. product-enforced), missing restrictions

**Operations and Flow** — What actions does the feature perform? In what sequence? Under what conditions?
- Find: operations with no trigger, unstated preconditions, parallel vs. sequential not established, skippable steps with no detection, branches not described

**Entities and Data** — What business objects does this feature create, read, modify, or destroy?
- Find: entities with no lifecycle, fields that drive behavior but weren't identified, state transitions not mapped, cross-feature data dependencies

**Business Rules and Policies** — What must always be true? What must never happen?
- Find: rules that conflict, rules with unnamed exceptions, policies not enforced in code, rules that apply differently per actor

**Decisions and Rationale** — What design choices were made, and why? What alternatives were rejected?
- Find: decisions without rationale, provisional decisions not flagged, choices made under constraints that no longer apply

**Risks and Hazards** — What could go wrong in implementation, in production, or for the customer?
- Find: high-severity risks without mitigation, calculation edge cases, concurrent write hazards, assumptions baked into the design that would break if an external factor changed

**Integration and Dependencies** — What does this feature depend on? What depends on it?
- Find: single points of failure, uncoordinated cross-team changes, unsafe intermediate deployment states

### When to use which lens

Start wherever the concept is richest. If the specialist has described a flow, Operations and Entities are the natural entry. If they've described actors and rules, go there first. The goal is to get something concrete into the graph quickly, then use the lenses as a gap-finding checklist: *"I have operations — do I have actors for each? I have actors — do I have restrictions? I have rules — do any conflict?"*

When a specialist describes things that span multiple lenses at once (actors, operations, and rules together), don't interrupt to restructure — absorb it, write it, then use the lenses to check what's still missing.

### Audience Adaptation

**Observe the specialist's vocabulary and match it.** Do they use technical terms (class names, API paths, database tables, enum values)? Engage at that level. Do they use business terms (invoices, customers, approval flows, pricing tiers)? Stay there. Never force a product owner to reason about implementation details in order to answer a business question.

**Always write graph nodes in English**, regardless of the language of the conversation. If the discussion happens in another language, translate concepts to English when writing `name`, `summary`, `rationale`, and other text fields to the graph. The discussion can continue in the specialist's language.

**When codebase cross-references reveal a conflict**, translate it to the specialist's level. Instead of *"the `InvoiceStatus` enum has no `PENDING_APPROVAL` value"*, say *"the system currently doesn't have an approval-pending state for invoices — is this something new, or should it already exist somewhere?"*

### Writing to the Graph

**Write whenever something is settled** — not at topic boundaries, not after every question, but when enough is known to create valid, useful nodes. Specific triggers:

- An actor is named and their basic permissions are established
- An operation's trigger, preconditions, and responsible actor are known
- A business rule is stated with its conditions and scope
- A decision is made with its rationale (even if status is still `"draft"`)
- A risk is identified with a severity estimate
- 3 or more substantive exchanges have happened since the last write — pause and write what has been established so far

**Do not batch writes to the end of a discussion block.** Incremental writes let the specialist see the graph grow and catch misunderstandings before they propagate. The session can be interrupted at any time — what hasn't been written hasn't been saved.

**Before each write — pre-write graph sync:**

Read the current graph state to catch duplicates or conflicts before modifying the intermediate files:

```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n:Knowledge) WHERE toLower(coalesce(n.name, n.summary, '')) CONTAINS '$TOPIC' RETURN n.id AS id, labels(n)[1] AS type, properties(n) AS props ORDER BY type LIMIT 60"
```

For each node returned:
- **Same `id`, same properties** → already present; skip — no update needed
- **Same `id`, conflicting property value** → do NOT overwrite; create a `Claim` node: `{id: "claim:conflict-<node-id>-<field>", summary: "Conflict on <field> for <node-id>: graph has '<existing>', current plan says '<incoming>'", confidence: "tentative", source: "concept"}`. Queue it as the next issue to resolve with the specialist. When resolved, write the agreed value and delete the conflict Claim: `MATCH (n:Claim {id: "claim:conflict-..."}) DETACH DELETE n`
- **No matching `id`** → new node; proceed

**Write sequence:**

1. Update `pr-nodes.json` — append new nodes, update existing ones (by matching `id`)
2. Update `pr-edges.json` — append new edges (deduplicate by `(source, target, type)`)
3. Push to Neo4j:
   ```bash
   node "$PLUGIN_ROOT/skills/grasp-concept/push-concept-graph.mjs" "$PROJECT_ROOT"
   ```
4. Verify — count returned nodes must match `pr-nodes.json`:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n:Knowledge {source: 'concept'}) RETURN labels(n)[1] AS type, n.name AS name, n.id AS id ORDER BY type, name"
   ```
   If counts don't match, report the discrepancy and investigate before continuing.
5. Update `concept-context.json`
6. Report what was captured: *"Recorded [N] nodes — [breakdown by type]. Continuing."*

**After every write, immediately scan for the next gap** (see below) and raise the most critical one as the next issue.

### Graph Density

The graph should be dense. A single substantive exchange typically produces **5–15 nodes** across multiple types. Use the full vocabulary — don't wait for a "natural" node, create them proactively when the concept warrants it.

After each write, scan the conversation since the last write for nodes that were missed:

- Every named abstraction the specialist introduced → `Concept` node
- Every uncertain or hedged statement ("maybe", "I think", "we'd have to verify", "it depends") → `Claim` node with `confidence: "tentative"`
- Every deliberate choice ("we decided to", "we went with X because") → `Decision` node with `rationale` and `scope[]`
- Every "must always be true" / "must never" / "non-negotiable" invariant → `Constraint` node with `condition` and `invariant`
- Every named action the system or actor performs → `Operation` node with `HAS_OPERATION` edge from Feature
- Every actor mentioned → `Actor` node (reuse from graph if same `id` exists)
- Every hazard surfaced → `Risk` node with `severity`, `probability`, `scope[]`; link via `HAS_RISK`, and `MITIGATED_BY` if a mitigation was stated

### Continuous Gap Detection

After every graph write, scan for these gaps and raise the most critical unresolved one as the next issue. This replaces a separate "gap analysis phase" — gaps are caught and resolved continuously.

| Gap | Check | Question form |
|-----|-------|--------------|
| Undefined term | `concept` nodes with vague `summary`, entities without lifecycle | *"You mentioned [X] — what exactly is it? Can you define it precisely?"* |
| Dangling operation | `operation` with no `performed_by` edge | *"Who initiates [operation]?"* |
| Unscoped rule | `business-rule`, `constraint`, `decision`, or `risk` without `scope[]` | *"Does [rule] apply everywhere, or only within [feature/context]?"* |
| Unmitigated high risk | `risk` with `severity: "high"` or `"critical"` and no `mitigated_by` | *"Is there any safeguard for [risk], or is it currently an open hazard?"* |
| Orphan decision | `decision` with no `rationale` | *"Why was [decision] made? What alternative was rejected?"* |
| Open decision | `decision` still at `status: "draft"` | *"Is [decision] settled, or is it still being worked out?"* |
| Contradiction | Two claims or rules that can't both be true | *"You said [A] earlier and now [B]. These conflict in [scenario]. Which wins, or are both right in different contexts?"* |
| Missing entity lifecycle | entity with no status or state transition info | *"When does a [entity] cease to exist or become invalid?"* |
| Actor without restriction | restricted operation with no `restricted_for` edge | *"Who cannot do [operation]? Is it open to all actors by default?"* |

**Termination safeguard:** If the same gap persists after 3 attempts to resolve it, create a `Claim` with `confidence: "tentative"` and `summary: "open question: [the unresolved issue]"` and move on.

---

## Phase 3: Final Gap Pass

When the concept feels substantially complete — the specialist confirms there's nothing major left to cover — do one comprehensive sweep across the full `pr-nodes.json` and `pr-edges.json`.

Run every check in the gap detection table above. For any gap found at this stage, ask targeted follow-up questions and write updated nodes before continuing.

A clean sweep means:
- All concepts have a non-vague `summary`
- All operations have at least one `performed_by` edge
- All rules, decisions, constraints, and risks have a `scope`
- All high/critical risks have either a `mitigated_by` edge or an explicit note that no mitigation exists yet
- All decisions have `rationale` and `status: "accepted"` or `"draft"` with a stated reason
- No unresolved contradictions between claims

---

## Phase 4: Final Consensus Check

When the gap pass is clean, present a structured synthesis for the specialist to correct:

> "Here is what I've recorded about [topic]. Please tell me anything that's wrong, missing, or described in a way you wouldn't recognize.
>
> **The feature:** [one-paragraph synthesis]
>
> **Who uses it:** [actor list with what each can and cannot do]
>
> **How it works:** [ordered operation list with preconditions]
>
> **The rules that govern it:** [business rules and constraints, in plain language]
>
> **What was decided and why:** [decisions with rationale]
>
> **The risks we identified:** [risk list grouped by severity]
>
> **What it depends on / exposes:** [integration summary]"

Then ask: *"Is there anything I've misrepresented, or anything important that isn't here?"*

If corrections are given, update the graph and repeat the synthesis for the corrected sections only.

When the specialist confirms the synthesis is correct:
- Mark all `claim` nodes with `confidence: "agreed"`
- Set all `decision` nodes to `status: "accepted"` (or `"draft"` if explicitly still open)
- Update `concept-context.json` status to `"complete"`

---

## Phase 5: Summary

Report to the specialist:

- **Feature captured:** name and one-sentence description
- **Actors:** list with permission summary
- **Operations:** count and list
- **Entities:** list
- **Business rules and constraints:** count
- **Decisions:** count, with status breakdown (accepted / draft)
- **Risks:** grouped by severity (critical → high → medium → low), with mitigation status
- **Open questions:** any items left at `status: "draft"` or `confidence: "tentative"`
- **Graph:** Stored in Neo4j

If open questions remain, offer to continue: *"There are [N] open items. Should we resolve them now, or revisit later?"*

Offer to launch the dashboard:

> Run `/grasp-dashboard` to visualize the knowledge graph.
