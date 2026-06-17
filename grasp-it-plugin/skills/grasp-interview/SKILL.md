---
name: grasp-interview
description: Interview a Product Specialist to extract product requirements into the knowledge graph. Use when you need to gather requirements, design decisions, business rules, constraints, and risks directly from a product specialist through deep, relentless questioning.
argument-hint: [topic area or feature name]
---

# /grasp-interview

Interview a Product Specialist relentlessly about a feature or domain until both of you hold exactly the same understanding. The goal is not to collect what the specialist volunteers — it is to excavate what they know, challenge what they assume, expose what they haven't considered, and produce a knowledge graph that is **complete, consistent, and unambiguous**.

The interview never ends because the specialist says "that's everything." It ends when you have analyzed the captured knowledge, found no gaps or contradictions, and confirmed the specialist agrees with your synthesis.

---

## When to Use

- When starting a new feature or significant change
- When migrating or re-implementing behavior that was never formally documented
- When the graph has `source: "code-analysis"` nodes about a feature but lacks the business intent behind them
- Use `/grasp-chat` when querying existing knowledge; use `/grasp-interview` when building new knowledge

---

## Graph Schema

**All nodes created by this skill carry `kind: "knowledge"` and `source: "interview"`.** This
distinguishes specialist-described knowledge from code-mined knowledge (`source: "code-analysis"`)
and enables queries that separate intent from implementation.

Interview nodes carry `generatedAt` (ISO 8601 timestamp) but do NOT carry `sourceCommit` or `sourceFiles` — those are only present on code-analysis nodes.

**Before writing any nodes or edges, read both schema documents:**
- `docs/architecture/neo4j-schema.md` — complete property list per node type, label convention, `toNeo4jLabel` mapping, UPPER_SNAKE_CASE relationship types, ID formats. **The push script does not validate property names** — a wrong key (e.g. `text` instead of `ruleText`) is silently written to the graph under the wrong name.
- `docs/graph/architecture.md` — interview-layer node/relationship diagram and node reuse guidelines.

**Neo4j label convention:** All knowledge nodes use a dual-label pattern: the base label `Knowledge` plus a secondary type label (e.g., `Knowledge:Feature`). Every node written by this skill must carry `kind: "knowledge"` and `source: "interview"` — these are required, not optional. When writing to Neo4j, always use `MERGE (n:Knowledge {id: $id}) SET n += $props SET n:\`SecondaryLabel\`` — do NOT merge on multiple labels simultaneously.

### Node Types and Reuse Guidelines

During an interview, check the graph before creating new nodes. The same node types can appear from either source (`code-analysis` or `interview`); only the `source` property differs.

| Node type | Description | Behavior in interview |
|-----------|-------------|----------------------|
| `feature` | A named product capability | **Reuse existing or create new.** If the interview is about a new feature, create it. If about an existing feature, find and extend it. |
| `operation` | A meaningful action within a feature | **Check existing.** If the interviewed user mentions an operation already in the graph, reuse it. Otherwise create a new one. |
| `actor` | A user role, user type, organizational unit, external party, or system agent | **Check existing.** Reuse known actors from the graph. Create new actors only if genuinely new roles are discovered. |
| `business-rule` | A high-level business policy | **Can be created.** One of the most important nodes for business logic. |
| `entity` | A named business object (e.g. Invoice, Interview, Offer) | **Check existing.** Ambiguous, duplicate, or synonym entities should be avoided. Check the graph for similar entities and ask the user if it's the same or different. |
| `decision` | A commitment or resolved question (`status: draft \| accepted \| deprecated`) | **Interview-specific.** Created only during interviews. Resolved questions and commitments. |
| `constraint` | A technical invariant or access condition the implementation must respect | **Can be created.** Technical invariants or access conditions stated during interview. |
| `concept` | A key abstraction or topic area named by the specialist | **Interview-specific.** Key abstractions named by the specialist. |
| `claim` | A tentative or unresolved assertion (`confidence: tentative \| agreed`) | **Interview-specific.** Use when something is stated but not yet settled — a `decision` is for resolved commitments, a `claim` is for things still subject to correction or confirmation. |
| `risk` | A potential negative outcome: implementation hazard, business exposure, logic pitfall | **Can be created.** Both code-visible and specialist-identified risks are stored the same way. |

**Interview-specific nodes** (only from `/grasp-interview`): `Decision`, `Concept`, `Claim`.

**Critical nodes for graph connectivity**: `Domain` and `Feature` must always be connected — they form the backbone of the graph structure. In 95%+ of interviews the domain already exists; find it in the graph and attach the feature to it.

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

SKILL_REAL=$(realpath ~/.agents/skills/grasp-interview 2>/dev/null || readlink -f ~/.agents/skills/grasp-interview 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-interview 2>/dev/null || readlink -f ~/.copilot/skills/grasp-interview 2>/dev/null || echo "")
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
    echo "[grasp-interview] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-interview] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
```

Create working directories and initialize intermediate files:

```bash
mkdir -p "$PROJECT_ROOT/.grasp-it/intermediate"
echo '{"nodes":[]}' > "$PROJECT_ROOT/.grasp-it/intermediate/pr-nodes.json"
echo '{"edges":[]}' > "$PROJECT_ROOT/.grasp-it/intermediate/pr-edges.json"
```

---

## Phase 1: Topic Orientation

### 1a. Determine the topic and author

The topic comes from:
1. `$ARGUMENTS` — if provided directly with the skill call
2. The current conversation context — if a feature was just described or is being discussed
3. Ask — if neither is available: *"What feature or domain area should we explore together?"*

If the topic is vague (e.g. "the invoicing thing" or "the new flow"), do not proceed to interview. First establish a precise name and a one-sentence description: *"Before we go deep, I want to make sure we're talking about the same thing. Can you give it a name and describe it in one sentence — what does it do and who benefits from it?"*

**Capture the author's identity** — use the system username (from `$USER` or `whoami`). This is stored on every interview node as `author` and enables tracing knowledge back to its source. If the specialist is different from the system user, note it in the interview context.

### 1b. Check existing graph knowledge

Query Neo4j across all three subgraph regions to get a complete picture of existing knowledge about the topic before building new nodes:

**Codebase elements** (what code exists related to the topic):
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$TOPIC'] AS terms MATCH (seed) WHERE seed.kind = 'codebase' AND any(t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t OR toLower(seed.filePath) CONTAINS t) RETURN labels(seed)[0] AS type, seed.name AS name, seed.filePath AS filePath, seed.complexity AS complexity LIMIT 10"
```

**Code-analysis knowledge** (what the codebase currently does):
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$TOPIC'] AS terms MATCH (seed) WHERE seed.kind = 'knowledge' AND seed.source = 'code-analysis' AND any(t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t) RETURN labels(seed)[0] AS type, seed.name AS name, seed.summary AS summary, seed.status AS status LIMIT 10"
```

**Interview knowledge** (what prior interviews captured):
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "WITH ['$TOPIC'] AS terms MATCH (seed) WHERE seed.kind = 'knowledge' AND seed.source = 'interview' AND any(t IN terms WHERE toLower(seed.name) CONTAINS t OR toLower(seed.summary) CONTAINS t OR toLower(coalesce(seed.rationale, '')) CONTAINS t) RETURN labels(seed)[0] AS type, seed.name AS name, seed.summary AS summary, seed.status AS status, seed.confidence AS confidence LIMIT 10"
```

If Neo4j query fails, report the error and **STOP**.

This gives you three distinct views:
- **Codebase**: related files, functions, classes — shows what implementation exists
- **Code-analysis**: features, operations, rules extracted from code — shows what the codebase does
- **Interview**: planned features, decisions, constraints from prior interviews — shows what is already captured

Surface findings to the specialist: *"The graph already has [X]. Should we build on it, replace it, or treat this as something separate?"*

**Also query for existing actors and domains** — well-known domain actors (e.g., `actor:pdl`, `actor:client`) may already exist in the graph from prior `/grasp-domain` or `/grasp-interview` runs:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n:Knowledge) WHERE n:Actor OR n:Domain RETURN n.id, n.name, labels(n)[1] AS type LIMIT 50"
```
Before creating any new actor node, check whether one with the same `id` already exists and reuse it instead of creating a duplicate.

**Also check for existing domain nodes** — the feature may belong to an existing domain:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (d:Domain) RETURN d.id, d.name LIMIT 20"
```
If the feature belongs to an existing domain, create a `HAS_FEATURE` edge from the domain to the new feature node.

**For deeper exploration**, use `/grasp-search` with Approaches A, B, and C — these provide subgraph-scoped search with relevance scoring and neighbor expansion, which is more powerful than the basic queries above.

### 1c. State the contract

Tell the specialist:

> "We're going to explore [topic] together. I'll ask you one question at a time — mostly open questions so you can describe things in your own words. At the end of each topic I'll paraphrase what I understood and you correct me. We'll keep going until we both agree the picture is complete and correct. I'll save what we agree on to the knowledge graph as we go."

Create `$PROJECT_ROOT/.grasp-it/intermediate/interview-context.json`:

```json
{
  "topic": "<topic name>",
  "author": "<specialist name or role>",
  "featureId": "feature:<kebab-name>",
  "startedAt": "<ISO timestamp>",
  "status": "in-progress",
  "aspects": {
    "identity": "pending",
    "actors": "pending",
    "operations": "pending",
    "entities": "pending",
    "rules": "pending",
    "decisions": "pending",
    "risks": "pending",
    "integration": "pending"
  }
}
```

---

## Phase 2: Aspect-by-Aspect Deep Interview

The interview is divided into **eight standard aspects** plus **topic-specific deep dives** (Phase 2.9). Work through each aspect completely before moving to the next. After completing each aspect, write what was learned to the intermediate graph files before continuing.

**The question lists below are not scripts — they are examples of the kinds of questions that expose gaps in each aspect.** For every topic, think about what is specific to THIS domain: its terminology, its risk profile, its unusual rules. Ask the questions that would surface inconsistencies in the concept as described — not a generic checklist. The goal is to find contradictions, undefined terms, unmitigated risks, and silent assumptions before anything is built.

Questions must be asked **one at a time**. Within each aspect: **open questions come first** — let the specialist establish their own framing before you impose yours. Hypothesis and paraphrase questions close each block, synthesizing what you heard and getting explicit confirmation before writing to the graph. **Never open a block with a hypothesis** — that leads the witness and suppresses knowledge that doesn't fit your current frame.

### Question Modes

Use all five modes throughout the interview — vary them to maintain pace and ensure accuracy:

**Open question** — requires a free-text description. Use to open each block. Let the specialist use their own words and framing.
> "Walk me through X. Describe it as if I know nothing about it yet."

**Concrete scenario** — name a specific situation and ask what happens. Use after the specialist has established their view, to probe edge cases and expose assumptions.
> "If actor A performs operation B while actor C is doing D — what should happen? And what actually happens today?"

**Quick confirmation** — a binary or short-option check. Use to verify specific details rapidly after an open answer.
> "Just to confirm: is this rule always in effect, or only in [specific context]? (always / only when X / other)"

**Hypothesis question** — state your assumption, ask for correction. Use **near the end of a block** to surface misunderstandings before you write to the graph. Not as an opener.
> "My current understanding is that X does Y. Is that right, or does it also/instead/never do Z?"

**Paraphrase check** — summarize what you understood and ask for explicit confirmation. **Always the last step** before writing nodes for an aspect.
> "Let me make sure I have this right: [your precise synthesis]. Is that accurate? What did I miss or get wrong?"

---

### Aspect 1: Identity and Scope

Goal: establish what the feature IS, what it is NOT, and what "done" looks like.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"What is [topic]? Describe it as if I've never heard of it — what it does, who benefits from it, and why it exists."* [OPEN]
2. *"What problem does this feature solve for the user? What would they have to do without it?"* [OPEN]
3. *"What is explicitly OUT of scope for this feature — things someone might expect but we're not doing?"* [OPEN]
4. *"What does a successful outcome look like? If I came back in three months and this was working perfectly, what would I observe?"* [OPEN / scenario]
5. *"Is there an existing feature this replaces, extends, or competes with?"* [OPEN]
6. *[HYPOTHESIS]* *"My current understanding of [topic] is: [your synthesis from answers above and the graph]. Is that right, or does it also / instead / never do [X]?"*
7. *[PARAPHRASE CHECK]* *"Let me make sure I have the shape of this right: [feature] is about [synthesis]. The problem it solves is [X]. It is specifically NOT [out-of-scope items]. Is that accurate? What did I miss or get wrong?"*

After this aspect, write to the graph:
- A `Feature` node with `status: "planned"` and a precise `summary`
- A `Concept` node for **every named abstraction** the specialist used — even informally. If they said "bonus framework" or "price component," those are Concept nodes.
- A `Claim` node (confidence: `"tentative"`) for any statement that was hedged or uncertain
- The `HAS_FEATURE` edge from the existing `Domain` node to the new `Feature` node (do NOT create a new Domain node — find the existing one)

---

### Aspect 2: Actors and Permissions

Goal: identify every role that interacts with this feature and what each can and cannot do.

An **actor** is a user role, user type, organizational unit, external party, or system agent that performs or is restricted from actions. Examples: "Manager", "Agency User", "Client Contact", "Finance Department", "Partner Agency", "Background Job", "External API". Name actors at the level of precision the business uses — a contact person at a client company is a valid actor (`actor:client-contact`), as is a department or an automated process. Generic names like "user" are not precise enough — give each actor its actual business role or identity.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"Who uses this feature? List every type of person, role, or system that interacts with it in any way."* [OPEN]
2. For each actor: *"What exactly can [actor] do with this feature? Be specific — not just 'use it' but what actions they initiate."* [OPEN]
3. *"Is there any role that can see this feature but cannot use it, or can use it but with restrictions?"* [OPEN]
4. *"Who is explicitly blocked from this? Is that enforced in the product or just a policy?"* [OPEN]
5. *[SCENARIO]* *"If [actor A] tries to do [operation] — which should only be for [actor B] — what happens? An error? Silent failure? Redirect?"*
6. *"Are there any temporary or contextual permissions — roles that gain or lose access based on state?"* [OPEN]
7. *[HYPOTHESIS]* *"Based on what you described and what I see in the graph, I believe the actors are: [list]. Is there anyone I missed or incorrectly included?"*
8. *[PARAPHRASE CHECK]* *"Let me confirm the permission picture: [actor A] can [actions]; [actor B] can [actions] but NOT [restrictions]. Is that accurate?"*

After this aspect, write to the graph:
- `Actor` nodes for each role identified (check graph first — reuse existing actors)
- `PERFORMED_BY` edges from operations to actors
- `RESTRICTED_FOR` edges for explicit blocks
- A `Constraint` node for each permission invariant (e.g. "only [actor] can [action]")
- A `Claim` node for any permission rule that was stated but not fully confirmed (confidence: `"tentative"`)
- A `Risk` node for any scenario where permission enforcement is unclear or could be bypassed

---

### Aspect 3: Operations and Flow

Goal: name every action the feature performs and understand their sequence, triggers, and conditions.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"Walk me through this feature step by step as if I'm the user. What happens first?"* [OPEN]
2. For each step: *"You said '[step]'. Give that a name — what would you call this operation in plain business language?"* [OPEN]
3. *"What must have happened before [operation] can run? Are there preconditions?"* [OPEN]
4. *"Can any of these operations run in parallel, or must they be sequential? What breaks if they run out of order?"* [OPEN]
5. *"What triggers each operation — a user action, a time schedule, another system, an event?"* [OPEN]
6. *[SCENARIO]* *"What happens if [operation A] is skipped — either by accident or by an actor who bypasses the UI? Does the system detect it? Does it matter?"*
7. *"Are there operations that only happen on certain paths — for example, only on first use, or only if a certain condition is met?"* [OPEN]
8. *[PARAPHRASE CHECK]* *"The flow I have is: [ordered list of operations with triggers and preconditions]. Is the sequence right? Did I miss any branches or optional paths?"*

After this aspect, write to the graph:
- `Operation` nodes for each named action (check graph — reuse existing operations)
- `HAS_OPERATION` edges from the Feature to each Operation
- `SEQUENCE` edges between Operations in order
- `PERFORMED_BY` edges from each Operation to its Actor
- A `Concept` node for any named state, trigger, or path condition the specialist introduced
- A `Claim` node for any precondition that was described but not fully verified (confidence: `"tentative"`)
- A `Risk` node for any operation that could be skipped or run out of order with harmful consequences

---

### Aspect 4: Entities and Data

Goal: identify every business object this feature creates, reads, modifies, or destroys, and what matters about each.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"What data does this feature work with? Name every object type involved — not database tables, but business concepts."* [OPEN]
2. For each entity: *"When is a [entity] created? What gives it life? When does it end?"* [OPEN]
3. *"Which fields on [entity] are significant for this feature's logic? Not all fields — just the ones that drive behavior."* [OPEN]
4. *"Are there states or statuses that [entity] moves through? What are the valid transitions?"* [OPEN]
5. *[SCENARIO]* *"If [entity] is in state X and [operation] runs — does it succeed, fail, or behave differently than when it's in state Y?"*
6. *"Is there any data this feature produces that other features consume? Or data it depends on that's produced elsewhere?"* [OPEN]
7. *[PARAPHRASE CHECK]* *"The entities I have are: [list with lifecycle summary]. For each one, does the lifecycle I described match what actually happens?"*

After this aspect, write to the graph:
- `Entity` nodes for each business object (check graph — reuse or extend existing entities)
- `USES_ENTITY` edges from the Feature and relevant Operations to each Entity
- A `Concept` node for any named state, status value, or lifecycle phase (e.g., `concept:invoice-draft-state`)
- A `Claim` node for any lifecycle transition that was described but seems conditional or uncertain
- A `BusinessRule` node for each valid/invalid state transition rule (e.g., "cannot transition from X to Y directly")
- A `Risk` node for any state transition that could be exploited or result in corrupt data

---

### Aspect 5: Business Rules and Policies

Goal: surface the "must", "must not", and "must always" statements that govern this feature.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"What are the non-negotiable rules for this feature? Things that must always be true, no matter what?"* [OPEN]
2. For each rule: *"When exactly does this rule apply? Is it always, or only in certain conditions?"* [OPEN]
3. *"What rules have exceptions? Name the exception and when it applies."* [OPEN]
4. *"Is there anything this feature must never do, even if asked to? Things that would be wrong regardless of who requests it?"* [OPEN]
5. *"Are any of these rules enforced today in code, or are they just policy? Which ones could theoretically be violated?"* [OPEN]
6. *"Are there rules that apply differently to different actors — the same action is allowed for one role but forbidden for another?"* [OPEN]
7. *[CHALLENGE — ask when contradictions emerge]* *"You said [rule A] earlier and now [rule B]. These seem to conflict in [scenario]. Which wins, or are they both right but in different contexts?"*
8. *[PARAPHRASE CHECK]* *"The rules I have are: [list with conditions]. Do any of these conflict with each other? Are there any I didn't capture?"*

After this aspect, write to the graph:
- `BusinessRule` nodes for each policy (one rule = one node; don't aggregate rules into one)
- `GOVERNS` edges from each BusinessRule to the Feature or Operation it governs
- `Constraint` nodes for technical invariants that must be enforced in code (distinct from policies)
- `CONSTRAINED_BY` edges from Feature/BusinessRule/Decision to their Constraints
- A `Claim` node for any rule that the specialist was uncertain about or that has exceptions not yet defined
- A `Decision` node if a rule represents a deliberate choice over alternatives (e.g., "we chose to require X rather than Y")
- `HAS_RISK` edges where a rule being violated would cause harm

---

### Aspect 6: Decisions and Rationale

Goal: capture every "we chose X over Y" commitment so future implementors understand why things are the way they are.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"What design choices were made for this feature that someone implementing it later might question?"* [OPEN]
2. For each decision: *"What were the alternatives you considered? Why did you reject them?"* [OPEN]
3. *"Are there any decisions that were made because of external constraints — time, technology, another team's API, a regulatory requirement?"* [OPEN]
4. *"Is there anything that's done a certain way for historical reasons that no longer apply — a legacy choice that lives on?"* [OPEN]
5. *"If the team revisited this feature in a year, what decision would they most likely want to change?"* [OPEN]
6. *"Are there any decisions that were made provisionally — 'for now' choices that need to be revisited?"* [OPEN]
7. *[PARAPHRASE CHECK]* *"The decisions I captured are: [list with rationale]. Are any of these still open, or are they all settled?"*

After this aspect, write to the graph:
- `Decision` nodes with `rationale` (why this, not alternatives), `scope[]`, and `status: "accepted"` or `"draft"`
- `DECIDES` edges from each Decision to the Feature or BusinessRule it resolves
- `CONSTRAINED_BY` edges where an external constraint forced a decision
- `Concept` nodes for key abstractions that were named during the rationale discussion
- `IMPLEMENTS` edges from Decisions to the Concepts they fulfill
- A `Claim` node (confidence: `"tentative"`) for any provisional or revisit-flagged decision
- `CL -[:SUPPORTS]-> DC` (Claim supports Decision) where a claim provides the evidence for a decision

---

### Aspect 7: Risks and Hazards

Goal: capture what the specialist knows could go wrong — in implementation, in production, or for the customer.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"What worries you most about implementing this feature? What could go wrong?"* [OPEN]
2. *"Where are the tricky edge cases in this feature's logic? Places where a developer could make an honest mistake that would be hard to detect?"* [OPEN]
3. For any calculation or financial logic: *"How does [calculation] work when [edge case — zero values, rounding, overflow, currency conversion, concurrent writes]?"* [OPEN / scenario]
4. *"What would a customer experience if this feature had a subtle bug? What would they see or lose?"* [OPEN]
5. *"Has anything like this gone wrong before — either with this feature in a previous version, or with a similar feature elsewhere in the product?"* [OPEN]
6. *"What assumptions are baked into this design that would break if [external factor] changed?"* [OPEN]
7. For each risk identified: *"How likely is this to happen? (low / medium / high) How bad is it if it does? (low / medium / high / critical)"* [OPEN]
8. *"Is there already a safeguard for this risk — a decision that prevents it, or a constraint that catches it?"* [OPEN]
9. *[PARAPHRASE CHECK]* *"The risks I have, ordered by severity: [list]. For the high/critical ones — which have no mitigation yet?"*

After this aspect, write to the graph:
- `Risk` nodes for each hazard identified, with `severity`, `probability`, and `scope[]`
- `HAS_RISK` edges from the Feature, Operation, or BusinessRule that carries the risk
- `MITIGATED_BY` edges from each Risk to the Decision or Constraint that addresses it (if any)
- Update existing `Decision` and `Constraint` nodes to add mitigation links where the specialist confirmed a safeguard
- A `Claim` node for any risk where probability or severity was estimated but not confirmed
- `APPLIES_IN` edges from Constraints or BusinessRules to the Feature/Operation where the risk lives

---

### Aspect 8: Integration and Dependencies

Goal: understand what this feature depends on and what depends on it.

Questions to ask (open first, hypothesis/paraphrase at end):

1. *"What other features or systems does this depend on? What would break if [dependency] changed or became unavailable?"* [OPEN]
2. *"What does this feature expose to the rest of the product? What do other features rely on it for?"* [OPEN]
3. *"Are there any external services, APIs, or third parties involved? What happens to this feature if that integration fails?"* [OPEN]
4. *"Is there anything about this feature that needs to be coordinated with another team or system owner?"* [OPEN]
5. *[SCENARIO]* *"If this feature is deployed but [downstream feature] hasn't been updated yet — what breaks? Is that a safe intermediate state?"*
6. *[PARAPHRASE CHECK]* *"The dependencies I have: this feature requires [X, Y, Z] to work. If any of those are unavailable, [consequence]. Other features depend on this for [what]. Is that complete?"*

After this aspect, write to the graph:
- A `Constraint` node for each dependency invariant (e.g., "requires X service to be available") with `APPLIES_IN` edge to the Feature
- A `Concept` node for each shared integration point, linked via `SUB_CONCEPT_OF` to the domain's parent Concept
- A `Risk` node for each integration that could fail, with severity and `MITIGATED_BY` if a fallback exists
- Update `scope[]` fields on relevant Decisions and BusinessRules to include cross-feature dependencies
- A `Claim` node for any dependency that the specialist was uncertain about

The knowledge schema has no direct feature-to-feature edge type. Cross-feature dependencies live in Constraints and shared Concepts.

---

### Phase 2.9: Topic-Specific Deep Dives

After all eight standard aspects, analyze what was discussed and identify topics that deserve a dedicated deep dive. **These are not optional** — they are the most important part of the interview for finding inconsistencies. The standard eight aspects give you breadth; these blocks give you depth where the concept is most fragile.

Create a topic-specific block for any topic where:
- A domain-specific term or concept was mentioned but not fully defined (e.g., "pricing formula", "assignment workflow", "approval chain")
- A calculation, state machine, or business process was described but you can see edge cases that weren't addressed
- Two rules or decisions seem potentially inconsistent — the block is to resolve the contradiction
- The answers felt thin, hedged, or non-specific — the block is to extract what wasn't volunteered
- Any topic where a developer could make a reasonable but wrong assumption

For each topic block, **design your questions specifically for that topic** — don't apply a generic template. Think: what would a developer get wrong about this? What would a bug look like? Where do the rules interact in unexpected ways? Ask the questions that expose those failure modes.

Structure of each topic block (same open-first principle):
1. Open with the topic and ask the specialist to describe it completely [OPEN]
2. Probe the edge cases and boundary conditions specific to this topic [OPEN / SCENARIO]
3. Surface the rules, constraints, and actors that apply [OPEN]
4. Test any apparent inconsistency with a concrete scenario [SCENARIO]
5. Synthesize and confirm [HYPOTHESIS → PARAPHRASE CHECK]

After each topic block, write the appropriate nodes:
- `Concept` nodes for the topic and its sub-concepts, linked with `SUB_CONCEPT_OF`
- `BusinessRule` nodes for rules that apply specifically to this topic
- `Constraint` nodes for technical invariants
- `Decision` nodes for any deliberate choices about how this topic works
- `Risk` nodes for edge cases that could cause production problems
- `Claim` nodes for anything still uncertain after the block

---

### Writing to the Graph After Each Aspect

The graph should be dense. A single aspect typically produces **5–15 nodes** across multiple types — not one or two. Use the full vocabulary: Feature, Operation, Actor, Entity, BusinessRule, Decision, Constraint, Concept, Claim, Risk. Every named abstraction the specialist introduced becomes a Concept node. Every uncertain statement becomes a Claim. Every deliberate choice becomes a Decision. Do not wait for a "natural" node — create them proactively.

After each aspect is completed and you have paraphrase-checked the key findings with the specialist:

1. Update `pr-nodes.json` — append new nodes, update existing ones (by matching `id`)
2. Update `pr-edges.json` — append new edges (deduplicate by `(source, target, type)`)
3. **Push the updated graph to Neo4j** by running `push-interview-graph.mjs`:
   ```bash
   node "$PLUGIN_ROOT/skills/grasp-interview/push-interview-graph.mjs" "$PROJECT_ROOT"
   ```
4. **Verify the push succeeded** by reading back from Neo4j:
   ```bash
   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n:Knowledge {source: 'interview'}) RETURN labels(n)[1] AS type, n.name AS name, n.id AS id ORDER BY type, name"
   ```
   Count the nodes returned. If the count does not match the number of nodes in `pr-nodes.json`, report the discrepancy to the specialist and investigate before continuing.
5. Mark the aspect complete in `interview-context.json`
6. Say briefly what was captured: *"I've recorded [N] nodes — [breakdown by type: X features, Y concepts, Z rules, etc.]. Moving on to [next aspect]."*

Do not batch graph writes to the end — capturing incrementally (including the Neo4j push and read-back) allows the specialist to see the graph grow and correct misunderstandings before they propagate.

---

## Phase 3: Gap Analysis Loop

After all eight aspects are complete, analyze the intermediate graph files (`pr-nodes.json` + `pr-edges.json`) for the following problems. For each problem found, ask targeted follow-up questions before accepting the interview as complete.

### Gap categories to check

**Undefined terms** — are there `concept` nodes with a `summary` that is still vague, or entity nodes whose lifecycle was never described? Ask: *"Earlier you mentioned [concept]. I captured it as [summary]. Is that precise enough, or is there a more exact definition?"*

**Dangling operations** — are there `operation` nodes with no `performed_by` edge? Ask: *"Who initiates [operation]? I don't have that recorded."*

**Unscoped rules** — are there `business-rule`, `constraint`, `decision`, or `risk` nodes without a `scope[]`? Ask: *"Does [rule/decision/risk] apply everywhere in the product, or only within [feature]?"*

**Unmitigated high risks** — are there `risk` nodes with `severity: "high"` or `"critical"` and no `mitigated_by` edge? Ask: *"For [risk] — is there currently any safeguard, plan, or design decision that addresses it? Or is it an open hazard?"*

**Orphan decisions** — are there `decision` nodes with no `rationale`? Ask: *"Why was [decision] made? What would have been the alternative?"*

**Missing status on decisions** — are there decisions still at `status: "draft"`? Ask: *"Is [decision] settled, or is it still being worked out?"*

**Contradictions** — are there two claims or rules that cannot both be true? Surface them: *"You said [A] earlier, and just now [B]. These seem to conflict when [scenario]. Which is right, or are they both right but in different contexts?"*

**Missing entity transitions** — are there entity nodes with no status/lifecycle information? Ask: *"When does a [entity] cease to exist or become invalid?"*

**Actors without restrictions** — does the feature have restricted operations but no `restricted_for` edges? Ask: *"Who cannot do [operation]? Is it open to all actors by default?"*

### Loop condition

After each gap analysis pass, if any problems were found and new questions were asked:
- Write updated nodes/edges to the intermediate files
- Run the gap analysis again on the updated graph
- Continue until a full pass finds no gaps

**Termination safeguard:** If the same gap category is still present after 3 consecutive passes (the specialist cannot or will not resolve it), stop looping on that category. Record a `claim` node with `confidence: "tentative"` and `summary: "open question: [the unresolved issue]"`. Move on.

A clean pass means:
- All concepts have a non-vague `summary`
- All operations have at least one `performed_by` edge
- All rules have a `scope`
- All high/critical risks have either a `mitigated_by` edge or an explicit note that no mitigation exists yet
- All decisions have `rationale` and `status: "accepted"` or `"draft"` with a reason
- No unresolved contradictions between claims

---

## Phase 4: Final Consensus Check

When the gap analysis passes cleanly, do a final synthesis check with the specialist.

Present a structured summary — this is not a question, it is a statement for them to correct:

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

Then ask: *"Is there anything I've misrepresented, or anything important that isn't there?"*

If corrections are given, update the graph and repeat the synthesis summary for the corrected sections only.

When the specialist confirms the synthesis is correct:
- Mark all `claim` nodes with `confidence: "agreed"`
- Set all `decision` nodes to `status: "accepted"` (or `"draft"` if explicitly still open)
- Update `interview-context.json` status to `"complete"`

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

If any open questions remain, offer to continue: *"There are [N] open items. Should we resolve them now, or revisit later?"*

Offer to launch the dashboard:

> Run `/grasp-dashboard` to visualize the knowledge graph.
