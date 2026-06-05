---
name: grasp-requirements
description: Interview a Product Specialist to extract product requirements into the knowledge graph. Use when you need to gather requirements, design decisions, business rules, and constraints directly from a product specialist through guided questioning.
argument-hint: [topic area]
---

# /grasp-requirements

Conduct a structured interview with a Product Specialist to extract product requirements into the knowledge graph. The interview continues until mutual confidence is reached — until both the agent and the Product Specialist understand the topic the same way. At that point, knowledge is extracted and stored.

## When to Use

- When starting a new feature or significant change
- When the existing graph's `:Knowledge:Semantic:Decision` and `:Knowledge:Semantic:Constraint` nodes need population
- When migrating or re-implementing behavior that was never formally documented
- Use `/grasp-chat` when querying existing knowledge; use `/grasp-requirements` when building new knowledge

## Graph Schema

**All nodes created by this skill carry `kind: "knowledge"` and `source: "interview"`.** This
distinguishes specialist-described knowledge from code-mined knowledge (`source: "code-analysis"`)
and enables queries that separate intent from implementation.

Product requirements knowledge uses these node types:

- `feature` — a named product capability
- `operation` — a meaningful action within a feature
- `actor` — a user role or system agent
- `business-rule` — a business policy or constraint
- `entity` — a named business object
- `decision` — a commitment or resolved question (`status: draft | accepted | deprecated`)
- `constraint` — a rule, invariant, or condition the implementation must respect
- `concept` — a key abstraction or topic area named by the specialist
- `claim` — an assertion made during the interview (`confidence: tentative | agreed`)
- `risk` — a potential negative outcome: implementation hazard, business exposure, calculation
  pitfall, data-loss scenario, customer-facing risk. Use when the specialist warns about
  what could go wrong.

Key relationship types for product requirements knowledge:

- `sub_concept_of` — concept composition (part-of hierarchy)
- `constrained_by` — a rule applies to a concept, decision, feature, or business rule
- `decides` — a claim leads to a decision, which resolves a feature or business rule
- `implements` — a decision fulfills a concept
- `supports` — evidence chain between claims
- `applies_in` — scope/context binding (constraint, rule, or risk → concept/feature/operation)
- `governs` — a business rule applies to a feature or operation
- `uses_entity` — a feature or operation works with an entity
- `performed_by` — an operation is performed by an actor
- `restricted_for` — an operation is forbidden for an actor
- `has_risk` — a feature, operation, business rule, or concept has an associated risk
- `mitigated_by` — a risk is addressed by a decision or constraint

Node IDs use prefixes: `feature:<kebab-name>`, `operation:<kebab-name>`, `actor:<kebab-name>`, `business-rule:<kebab-name>`, `entity:<kebab-name>`, `decision:<kebab-name>`, `constraint:<kebab-name>`, `concept:<kebab-name>`, `claim:<uuid-short>`, `risk:<kebab-name>`.

Decision status lifecycle: `draft` → `accepted` → `deprecated`.

---

## Phase 0: Setup

Resolve `PROJECT_ROOT` and `PLUGIN_ROOT` using the standard pattern:

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
COPILOT_SELF_RELATIVE=$P([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
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
```

Create working directories:
```bash
mkdir -p "$PROJECT_ROOT/.grasp-it/intermediate"
```

---

## Phase 1: Topic Confirmation

1. Confirm the topic area with the Product Specialist: `$ARGUMENTS` or the user's initial statement
2. If no topic was provided, ask the Product Specialist what area they want to cover
3. State the goal: "We're going to explore [topic] together. I'll ask questions to make sure I understand it the same way you do. When we're both confident we understand it fully, I'll record what we've agreed on."
4. Create an `interview-context.json`:
```json
{
  "topic": "<topic area>",
  "startedAt": "<ISO timestamp>",
  "status": "in-progress"
}
```

---

## Phase 2: Structured Interview

### Interview Strategy

Use the `pr-interviewer` agent definition. The agent:

1. Asks structured, probing questions to extract:
   - **Concepts** — what are the key abstractions? What parts make up the whole?
   - **Constraints** — what rules, invariants, conditions must hold? When do they apply?
   - **Decisions** — what was decided, and why? What alternatives were considered?
   - **Claims** — what assertions are made? Are they agreed or still tentative?
   - **Scope** — where/when does each rule or decision apply?
   - **Risks** — what could go wrong? What edge cases in logic (e.g. rounding, ordering, concurrency)?
     What business exposure does a wrong implementation create for customers? What could be lost
     during migration or refactoring? Which rule interactions are dangerous?

2. Tracks consensus — a topic is "done" when:
   - All key concepts are named and described
   - All constraints have `condition` and `invariant` defined
   - All decisions have `rationale` and `scope`
   - All active claims have `confidence: agreed`

3. Writes nodes incrementally to `$PROJECT_ROOT/.grasp-it/intermediate/pr-nodes.json`:
```json
{
  "nodes": [
    { "id": "concept:<name>", "type": "concept", "kind": "knowledge", "source": "interview", "name": "...", "summary": "...", "tags": [], "complexity": "moderate" },
    { "id": "decision:<name>", "type": "decision", "kind": "knowledge", "source": "interview", "name": "...", "summary": "...", "rationale": "...", "status": "proposed", "scope": [], "tags": [], "complexity": "moderate" },
    { "id": "constraint:<name>", "type": "constraint", "kind": "knowledge", "source": "interview", "name": "...", "condition": "...", "invariant": "...", "scope": [], "tags": [], "complexity": "simple" },
    { "id": "risk:<name>", "type": "risk", "kind": "knowledge", "source": "interview", "name": "...", "summary": "...", "severity": "medium", "probability": "medium", "mitigation": "...", "scope": [], "tags": [] }
  ]
}
```

4. Writes edges to `$PROJECT_ROOT/.grasp-it/intermediate/pr-edges.json`:
```json
{
  "edges": [
    { "source": "decision:<name>", "target": "concept:<name>", "type": "implements", "direction": "forward", "weight": 1.0 },
    { "source": "concept:<name>", "target": "constraint:<name>", "type": "constrained_by", "direction": "forward", "weight": 1.0 },
    { "source": "claim:<uuid>", "target": "decision:<name>", "type": "decides", "direction": "forward", "weight": 0.8 },
    { "source": "feature:<name>", "target": "risk:<name>", "type": "has_risk", "direction": "forward", "weight": 1.0 },
    { "source": "risk:<name>", "target": "decision:<name>", "type": "mitigated_by", "direction": "forward", "weight": 0.9 }
  ]
}
```

### Probing Technique

Ask questions in this order for each concept area:

1. **What** — What is this thing? Can you describe it in one or two sentences?
2. **Parts** — What sub-parts does it have? What are the components that make it up?
3. **Rules** — What must always be true about it? What conditions trigger different behavior?
4. **Decisions** — What choices were made about how it works? Why those choices?
5. **Scope** — When/where does this apply? Only in this feature? For all users?
6. **Risks** — What could go wrong if this is implemented incorrectly? What edge cases are tricky (e.g. rounding, ordering, concurrent updates)? What would a customer lose or experience incorrectly? What has gone wrong before or almost went wrong?
7. **Evidence** — Is there documentation, a ticket, or code that shows this?

For each risk identified, also ask:
- How likely is it to happen? (low / medium / high)
- How severe would the impact be? (low / medium / high / critical)
- Is there already a decision or constraint that mitigates it?

For each question, mark the response as `tentative` or `agreed`. Switch to `agreed` only when the Product Specialist confirms and you paraphrase back their meaning and they confirm your paraphrase is correct.

---

## Phase 3: Consensus Check

Periodically (or when the Product Specialist signals done), verify mutual understanding:

1. Summarize back what was agreed in the conversation:
   - List the key concepts and their sub-concepts
   - List the constraints with their invariants
   - List the decisions with their rationale and scope
   - List all identified risks with their severity and any known mitigations
   - List any claims that are still tentative

2. Ask: "Have I understood this correctly? Is there anything I've missed or misrepresented?"

3. If the Product Specialist confirms, mark all current claims as `confidence: agreed`, set all current decisions to `status: accepted`

4. If gaps remain, continue interviewing until consensus

---

## Phase 4: Merge into Knowledge Graph

1. Read the existing `$PROJECT_ROOT/.grasp-it/knowledge-graph.json` (if it exists)
2. Read the new `pr-nodes.json` and `pr-edges.json`
3. Merge:
   - Nodes with the same `id` are deduplicated (keep existing if already `accepted` or `implemented`, otherwise update)
   - Edges are deduplicated by `(source, target, type)` composite
   - All new nodes/edges are appended
4. Ensure a `layer:knowledge` layer exists — add any new Product Specialist-derived nodes to its `nodeIds`
5. Validate the merged graph using the schema validation
6. Write the merged graph back to `$PROJECT_ROOT/.grasp-it/knowledge-graph.json`

---

## Phase 5: Summary

Report to the user:
- Topics covered
- Decisions extracted (with rationale)
- Constraints extracted (with invariants)
- Concepts extracted (with sub-concept hierarchy)
- Risks identified (grouped by severity: critical → high → medium → low)
- Any gaps or open questions remaining
- Path to the updated graph

Offer to launch the dashboard:

> Run `/grasp-dashboard` to view the updated knowledge graph.

---

## Reference: Product Requirements Interview Node Shapes

```
Decision node:
{
  "id": "decision:<kebab-name>",
  "type": "decision",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what was decided>",
  "rationale": "<why this decision>",
  "status": "accepted",
  "scope": ["auth", "frontend"],
  "tags": ["auth", "security"],
  "complexity": "moderate"
}

Constraint node:
{
  "id": "constraint:<kebab-name>",
  "type": "constraint",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "condition": "<when this applies>",
  "invariant": "<what must hold true>",
  "scope": ["auth"],
  "tags": ["security"],
  "complexity": "simple"
}

Concept node:
{
  "id": "concept:<kebab-name>",
  "type": "concept",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<description>",
  "tags": [],
  "complexity": "moderate"
}

Claim node:
{
  "id": "claim:<short-uuid>",
  "type": "claim",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<the assertion>",
  "confidence": "agreed",
  "rationale": "<evidence or reasoning>",
  "tags": [],
  "complexity": "simple"
}

Risk node:
{
  "id": "risk:<kebab-name>",
  "type": "risk",
  "kind": "knowledge",
  "source": "interview",
  "name": "<name>",
  "summary": "<what could go wrong and why it matters>",
  "severity": "high",
  "probability": "medium",
  "mitigation": "<how this risk is or could be addressed>",
  "scope": ["<feature-or-domain>"],
  "tags": []
}
```