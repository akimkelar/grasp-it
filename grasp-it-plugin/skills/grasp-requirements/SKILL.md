---
name: grasp-requirements
description: Interview a Product Specialist to extract product requirements into the knowledge graph. Use when you need to gather requirements, design decisions, business rules, constraints, and risks directly from a product specialist through deep, relentless questioning.
argument-hint: [topic area or feature name]
---

# /grasp-requirements

Interview a Product Specialist relentlessly about a feature or domain until both of you hold exactly the same understanding. The goal is not to collect what the specialist volunteers — it is to excavate what they know, challenge what they assume, expose what they haven't considered, and produce a knowledge graph that is **complete, consistent, and unambiguous**.

The interview never ends because the specialist says "that's everything." It ends when you have analyzed the captured knowledge, found no gaps or contradictions, and confirmed the specialist agrees with your synthesis.

---

## When to Use

- When starting a new feature or significant change
- When migrating or re-implementing behavior that was never formally documented
- When the graph has `source: "code-analysis"` nodes about a feature but lacks the business intent behind them
- Use `/grasp-chat` when querying existing knowledge; use `/grasp-requirements` when building new knowledge

---

## Graph Schema

**All nodes created by this skill carry `kind: "knowledge"` and `source: "interview"`.** This
distinguishes specialist-described knowledge from code-mined knowledge (`source: "code-analysis"`)
and enables queries that separate intent from implementation.

Node types:

- `feature` — a named product capability
- `operation` — a meaningful action within a feature
- `actor` — a user role, user type, organizational unit, external party, or system agent that performs or is restricted from actions
- `business-rule` — a high-level business policy
- `entity` — a named business object (e.g. Invoice, Interview, Offer)
- `decision` — a commitment or resolved question (`status: draft | accepted | deprecated`)
- `constraint` — a technical invariant or access condition the implementation must respect
- `concept` — a key abstraction or topic area named by the specialist during the interview
- `claim` — a tentative or unresolved assertion made during the interview (`confidence: tentative | agreed`); use when something is stated but not yet settled — a `decision` is for resolved commitments, a `claim` is for things still subject to correction or confirmation
- `risk` — a potential negative outcome: implementation hazard, business exposure, logic pitfall, edge-case in calculation logic, data-loss scenario, customer-facing harm

Key relationship types:

- `sub_concept_of` — concept composition (part-of hierarchy)
- `constrained_by` — a rule applies to a concept, decision, feature, or business rule
- `decides` — a claim leads to a decision, which resolves a feature or business rule
- `implements` — a decision fulfills a concept
- `supports` — evidence chain between claims
- `applies_in` — scope/context binding
- `governs` — a business rule applies to a feature or operation
- `uses_entity` — a feature or operation works with an entity
- `performed_by` — an operation is performed by an actor
- `restricted_for` — an operation is forbidden for an actor
- `has_risk` — a feature, operation, business rule, or concept has an associated risk
- `mitigated_by` — a risk is addressed by a decision or constraint

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

SKILL_REAL=$(realpath ~/.agents/skills/grasp-requirements 2>/dev/null || readlink -f ~/.agents/skills/grasp-requirements 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-requirements 2>/dev/null || readlink -f ~/.copilot/skills/grasp-requirements 2>/dev/null || echo "")
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
    echo "[grasp-requirements] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

echo "[grasp-requirements] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

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

### 1a. Determine the topic

The topic comes from:
1. `$ARGUMENTS` — if provided directly with the skill call
2. The current conversation context — if a feature was just described or is being discussed
3. Ask — if neither is available: *"What feature or domain area should we explore together?"*

If the topic is vague (e.g. "the invoicing thing" or "the new flow"), do not proceed to interview. First establish a precise name and a one-sentence description: *"Before we go deep, I want to make sure we're talking about the same thing. Can you give it a name and describe it in one sentence — what does it do and who benefits from it?"*

### 1b. Check existing graph knowledge

Query Neo4j for nodes related to the topic:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) WHERE n.name CONTAINS '$TOPIC' OR any(t IN coalesce(n.tags, []) WHERE toLower(t) CONTAINS toLower('$TOPIC')) RETURN n LIMIT 20"
```
If Neo4j query fails, report the error and **STOP**.

Look for nodes whose `id`, `name`, or `tags` relate to the topic. If you find relevant existing nodes:

- Surface them to the specialist: *"The graph already has [X]. Should we build on it, replace it, or treat this as something separate?"*
- If the existing nodes came from `source: "code-analysis"`, tell the specialist: *"I have some code-mined knowledge about this. I'll use it as a starting point and ask you to confirm, extend, or correct it."*

### 1c. State the contract

Tell the specialist:

> "We're going to explore [topic] together. I'll ask you one question at a time. For each question I'll tell you what I currently think the answer is — your job is to correct me, extend me, or confirm me. When I think I understand something, I'll paraphrase it back and you confirm. We'll keep going until we both agree the picture is complete and correct. I'll save what we agree on to the knowledge graph as we go."

Create `$PROJECT_ROOT/.grasp-it/intermediate/interview-context.json`:

```json
{
  "topic": "<topic name>",
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

The interview is divided into **eight aspects**. Work through each aspect completely before moving to the next. After completing each aspect, write what was learned to the intermediate graph files before continuing.

Questions must be asked **one at a time**. Before asking, state your current hypothesis so the specialist corrects rather than explains from scratch.

### Question Modes

Use all three modes throughout the interview — vary them to maintain pace:

**Open question** — requires a free-text description. Use when you need the specialist's own framing.
> "Describe how X works in your own words. Don't worry about being precise yet."

**Hypothesis question** — state your assumption, ask for correction. Use for most questions.
> "My understanding is that X does Y. Is that right, or does it also/instead/never do Z?"

**Concrete scenario** — name a specific situation and ask what happens. Use to probe edge cases and expose assumptions.
> "If actor A performs operation B while actor C is doing D — what should happen? And what actually happens today?"

**Quick confirmation** — a binary or short-option check. Use to verify details rapidly after an open answer.
> "Just to confirm: is this rule always in effect, or only in [specific context]? (always / only when X / other)"

**Paraphrase check** — summarize what you understood and ask for explicit confirmation before writing to graph.
> "Let me make sure I have this right: [your precise synthesis]. Is that accurate? What did I miss or get wrong?"

---

### Aspect 1: Identity and Scope

Goal: establish what the feature IS, what it is NOT, and what "done" looks like.

Questions to ask (one at a time, hypothesis-first):

1. *"My current understanding of [topic] is: [your synthesis from context/graph]. What's wrong or incomplete about that?"*
2. *"What problem does this feature solve for the user? What would they have to do without it?"*
3. *"What is explicitly OUT of scope for this feature — things someone might expect but we're not doing?"*
4. *"What does a successful outcome look like? If I came back in three months and this was working perfectly, what would I observe?"*
5. *"Is there an existing feature this replaces, extends, or competes with?"*

After the last answer in this aspect, write a `feature` node and any `concept` nodes that emerged.

---

### Aspect 2: Actors and Permissions

Goal: identify every role that interacts with this feature and what each can and cannot do.

Questions to ask:

An **actor** is a user role, user type, organizational unit, external party, or system agent that performs or is restricted from actions. Examples: "Manager", "Agency User", "Client Contact", "Finance Department", "Partner Agency", "Background Job", "External API". Name actors at the level of precision the business uses — a contact person at a client company is a valid actor (`actor:client-contact`), as is a department or an automated process. Generic names like "user" are not precise enough — give each actor its actual business role or identity.

1. *"Who uses this feature? I'll list who I think is involved: [list from graph/context]. Who's missing, and who on that list actually isn't involved?"*
2. For each actor: *"What exactly can [actor] do with this feature? Be specific — not just 'use it' but what actions they initiate."*
3. *"Is there any role that can see this feature but cannot use it, or can use it but with restrictions?"*
4. *"Who is explicitly blocked from this? Is that enforced in the product or just a policy?"*
5. Scenario: *"If [actor A] tries to do [operation] — which should only be for [actor B] — what happens? An error? Silent failure? Redirect?"*
6. *"Are there any temporary or contextual permissions — roles that gain or lose access based on state?"*

After this aspect, write `actor` nodes and `performed_by` / `restricted_for` edges.

---

### Aspect 3: Operations and Flow

Goal: name every action the feature performs and understand their sequence, triggers, and conditions.

Questions to ask:

1. *"Walk me through this feature step by step as if I'm the user. What happens first?"*
2. For each step: *"You said '[step]'. Give that a name — what would you call this operation in plain business language?"*
3. *"What must have happened before [operation] can run? Are there preconditions?"*
4. *"Can any of these operations run in parallel, or must they be sequential? What breaks if they run out of order?"*
5. *"What triggers each operation — a user action, a time schedule, another system, an event?"*
6. Scenario: *"What happens if [operation A] is skipped — either by accident or by an actor who bypasses the UI? Does the system detect it? Does it matter?"*
7. *"Are there operations that only happen on certain paths — for example, only on first use, or only if a certain condition is met?"*

After this aspect, write `operation` nodes and `sequence` / `performed_by` / `has_operation` edges.

---

### Aspect 4: Entities and Data

Goal: identify every business object this feature creates, reads, modifies, or destroys, and what matters about each.

Questions to ask:

1. *"What data does this feature work with? Name every object type involved — not database tables, but business concepts."*
2. For each entity: *"When is a [entity] created? What gives it life? When does it end?"*
3. *"Which fields on [entity] are significant for this feature's logic? Not all fields — just the ones that drive behavior."*
4. *"Are there states or statuses that [entity] moves through? What are the valid transitions?"*
5. Scenario: *"If [entity] is in state X and [operation] runs — does it succeed, fail, or behave differently than when it's in state Y?"*
6. *"Is there any data this feature produces that other features consume? Or data it depends on that's produced elsewhere?"*

After this aspect, write `entity` nodes and `uses_entity` edges.

---

### Aspect 5: Business Rules and Policies

Goal: surface the "must", "must not", and "must always" statements that govern this feature.

Questions to ask:

1. *"What are the non-negotiable rules for this feature? Things that must always be true, no matter what?"*
2. For each rule: *"When exactly does this rule apply? Is it always, or only in certain conditions?"*
3. *"What rules have exceptions? Name the exception and when it applies."*
4. *"Is there anything this feature must never do, even if asked to? Things that would be wrong regardless of who requests it?"*
5. *"Are any of these rules enforced today in code, or are they just policy? Which ones could theoretically be violated?"*
6. Challenge: *"You said [rule A] and earlier you said [rule B]. These seem to conflict in [scenario]. Which wins?"* (Ask this when contradictions emerge.)
7. *"Are there rules that apply differently to different actors — the same action is allowed for one role but forbidden for another?"*

After this aspect, write `business-rule` nodes and `governs` edges. Write `constraint` nodes for the technical invariants.

---

### Aspect 6: Decisions and Rationale

Goal: capture every "we chose X over Y" commitment so future implementors understand why things are the way they are.

Questions to ask:

1. *"What design choices were made for this feature that someone implementing it later might question?"*
2. For each decision: *"What were the alternatives you considered? Why did you reject them?"*
3. *"Are there any decisions that were made because of external constraints — time, technology, another team's API, a regulatory requirement?"*
4. *"Is there anything that's done a certain way for historical reasons that no longer apply — a legacy choice that lives on?"*
5. *"If the team revisited this feature in a year, what decision would they most likely want to change?"*
6. *"Are there any decisions that were made provisionally — 'for now' choices that need to be revisited?"*

After this aspect, write `decision` nodes with `rationale` and `scope`. Write `decides` edges.

---

### Aspect 7: Risks and Hazards

Goal: capture what the specialist knows could go wrong — in implementation, in production, or for the customer.

Questions to ask:

1. *"What worries you most about implementing this feature? What could go wrong?"*
2. *"Where are the tricky edge cases in this feature's logic? Places where a developer could make an honest mistake that would be hard to detect?"*
3. For any calculation or financial logic: *"How does [calculation] work when [edge case — zero values, rounding, overflow, currency conversion, concurrent writes]?"*
4. *"What would a customer experience if this feature had a subtle bug? What would they see or lose?"*
5. *"Has anything like this gone wrong before — either with this feature in a previous version, or with a similar feature elsewhere in the product?"*
6. *"What assumptions are baked into this design that would break if [external factor] changed?"*
7. For each risk identified: *"How likely is this to happen? (low / medium / high) How bad is it if it does? (low / medium / high / critical)"*
8. *"Is there already a safeguard for this risk — a decision that prevents it, or a constraint that catches it?"*

After this aspect, write `risk` nodes and `has_risk` / `mitigated_by` edges. Update existing `decision` / `constraint` nodes with mitigation links.

---

### Aspect 8: Integration and Dependencies

Goal: understand what this feature depends on and what depends on it.

Questions to ask:

1. *"What other features or systems does this depend on? What would break if [dependency] changed or became unavailable?"*
2. *"What does this feature expose to the rest of the product? What do other features rely on it for?"*
3. *"Are there any external services, APIs, or third parties involved? What happens to this feature if that integration fails?"*
4. *"Is there anything about this feature that needs to be coordinated with another team or system owner?"*
5. Scenario: *"If this feature is deployed but [downstream feature] hasn't been updated yet — what breaks? Is that a safe intermediate state?"*

After this aspect, record integration dependencies as:
- A `constraint` node (e.g. "requires X service to be available") with an `applies_in` edge to the feature
- A `concept` node for any shared integration point, linked with `sub_concept_of` to the owning feature's domain concept
- `scope[]` fields on decisions and business rules that cross feature boundaries

The knowledge schema has no direct feature-to-feature edge type. Cross-feature dependencies live in constraints and shared concepts.

---

### Writing to the Graph After Each Aspect

After each aspect is completed and you have paraphrase-checked the key findings with the specialist:

1. Update `pr-nodes.json` — append new nodes, update existing ones (by matching `id`)
2. Update `pr-edges.json` — append new edges (deduplicate by `(source, target, type)`)
3. Mark the aspect complete in `interview-context.json`
4. Say briefly what was captured: *"I've recorded [N] concepts, [M] rules, and [K] risks from this section. Moving on to [next aspect]."*

Do not batch graph writes to the end — capturing incrementally allows the specialist to see the graph grow and correct misunderstandings before they propagate.

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

## Phase 5: Merge into Knowledge Graph

### 5a. Load existing graph

Query Neo4j for the existing knowledge graph:
```bash
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH (n) RETURN n"
node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "MATCH ()-[r]->() RETURN r"
```
If Neo4j query fails, report the error and **STOP**.

Read `pr-nodes.json` and `pr-edges.json` as the incoming interview output.

### 5b. Classify each incoming node

For each incoming node, compare against all existing nodes by `id`:

- **Same `id`, same `source: "interview"`** — re-run of the same skill on the same topic:
  - Update `summary`, `rationale`, `scope`, `tags` with the incoming values
  - If the existing node has `status: "accepted"` or `"implemented"`, keep that status (do not downgrade to `"draft"`)
  - Keep all existing edges; append incoming edges that are not already present (deduplicate by `(source, target, type)`)

- **Same `id`, different `source`** (e.g., existing has `source: "code-analysis"`, incoming has `source: "interview"`) — concurrent runs with different perspectives:
  - **Do not overwrite.** Rename the incoming node's `id` by appending a double-dash suffix and the source name: `feature:invoice-assignment` becomes `feature:invoice-assignment--interview`
  - This preserves both perspectives explicitly. A later query can show divergences: "here is what the code does vs. what the PO wants."

- **New `id`** (no existing node with that id):
  - Append the incoming node as-is

### 5c. Track conflicts for user reporting

Maintain a `conflicts[]` list: for every same-`id`, different-`source` rename, record `{ id, existingSource, incomingSource, existingSummary, incomingSummary }`.

### 5d. Merge edges

Edges: deduplicate by `(source, target, type)` composite. All new edges are appended; existing edges are preserved.

### 5e. Ensure layer exists

Ensure a `layer:knowledge` layer exists in the graph — add all new (or renamed) node IDs to its `nodeIds` list.

### 5f. Validate and write

1. Validate the merged graph against the schema
2. Write the merged graph back to Neo4j:
   ```bash
   # Write nodes and edges to Neo4j via run-query.mjs
   ```
   If Neo4j write fails, report the error and **STOP**.

### 5g. Report conflicts to user

If `conflicts` is non-empty, after writing the graph report to the user:

> "I found [N] nodes that already existed from code analysis. Here's where the interview description differs from what the code does:
> - **[id]**: code says \"[existingSummary]\" / interview says \"[incomingSummary]\"
> ..."

This turns a merge conflict into actionable information — the implementor knows where intent and implementation diverge.

---

## Phase 6: Summary

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

---

## Reference: Node Shapes

```jsonc
{
  "id": "feature:<kebab-name>",
  "type": "feature",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<one-paragraph description>",
  "status": "planned",
  "tags": [],
  "complexity": "moderate"
}

{
  "id": "operation:<kebab-name>",
  "type": "operation",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what this action does>",
  "status": "planned",
  "tags": []
}

{
  "id": "actor:<kebab-name>",
  "type": "actor",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<who this is>",
  "permissions": ["<what they can do>"],
  "restrictions": ["<what they cannot do>"],
  "tags": []
}

{
  "id": "business-rule:<kebab-name>",
  "type": "business-rule",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what the rule says>",
  "ruleText": "<plain-language policy statement>",
  "status": "active",
  "scope": ["<feature-or-domain>"],
  "tags": []
}

{
  "id": "entity:<kebab-name>",
  "type": "entity",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what this object is and its lifecycle>",
  "tags": []
}

{
  "id": "decision:<kebab-name>",
  "type": "decision",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what was decided>",
  "rationale": "<why this, not alternatives>",
  "status": "accepted",
  "scope": ["<feature-or-domain>"],
  "tags": []
}

{
  "id": "constraint:<kebab-name>",
  "type": "constraint",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "condition": "<when this applies>",
  "invariant": "<what must always hold true>",
  "scope": ["<feature>"],
  "tags": []
}

{
  "id": "concept:<kebab-name>",
  "type": "concept",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<precise definition — not vague>",
  "tags": []
}

// Claims use a short UUID rather than kebab-case because multiple distinct claims can exist
// about the same topic and a name-based ID would collide. Generate 8 random hex characters.
{
  "id": "claim:<short-uuid>",
  "type": "claim",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<the assertion>",
  "confidence": "agreed",
  "rationale": "<evidence or reasoning>",
  "tags": []
}

{
  "id": "risk:<kebab-name>",
  "type": "risk",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what could go wrong and why it matters>",
  "severity": "high",
  "probability": "medium",
  "mitigation": "<how this risk is or could be addressed — empty string if none>",
  "scope": ["<feature-or-domain>"],
  "tags": []
}
```
