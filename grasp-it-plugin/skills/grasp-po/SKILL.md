---
name: grasp-po
description: Interview a Product Owner to extract product knowledge into the knowledge graph. Use when you need to gather requirements, design decisions, business rules, and constraints directly from a PO through guided questioning.
argument-hint: [topic area]
---

# /grasp-po

Conduct a structured interview with a Product Owner (PO) to extract product knowledge into the knowledge graph. The interview continues until mutual confidence is reached — until both the agent and PO understand the topic the same way. At that point, knowledge is extracted and stored.

## When to Use

- When starting a new feature or significant change
- When the existing graph's `:Knowledge:Semantic:Decision` and `:Knowledge:Semantic:Constraint` nodes need population
- When migrating or re-implementing behavior that was never formally documented
- Use `/grasp-chat` when querying existing knowledge; use `/grasp-po` when building new knowledge

## Graph Schema

PO-extracted knowledge uses these node types:

- `decision` — a commitment or resolved question (`status: proposed | accepted | implemented`)
- `constraint` — a rule, invariant, or condition the implementation must respect
- `concept` — a topic or subject (extended with `subConcepts[]`, `constrainedBy[]`)
- `claim` — an assertion (extended with `confidence: tentative | agreed`)

Key relationship types for PO knowledge:

- `sub_concept_of` — concept composition (part-of hierarchy)
- `constrained_by` — a rule applies to a concept or decision
- `decides` — a claim leads to a decision
- `implements` — a decision fulfills a concept
- `supports` — evidence chain between claims
- `applies_in` — scope/context binding

Node IDs use prefixes: `decision:<kebab-name>`, `constraint:<kebab-name>`, `concept:<kebab-name>`, `claim:<uuid-short>`.

Status lifecycle: `proposed` → `accepted` → `implemented`.

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

SKILL_REAL=$(realpath ~/.agents/skills/grasp-po 2>/dev/null || readlink -f ~/.agents/skills/grasp-po 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-po 2>/dev/null || readlink -f ~/.copilot/skills/grasp-po 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$P([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

PLUGIN_ROOT=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT}" \
  "$HOME/.grasp-it-plugin" \
  "$SELF_RELATIVE" \
  "$COPILOT_SELF_RELATIVE" \
  "$HOME/.codex/grasp-it/grasp-it-plugin" \
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

1. Confirm the topic area with the PO: `$ARGUMENTS` or the user's initial statement
2. If no topic was provided, ask the PO what area they want to cover
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

Use the `po-interviewer` agent definition. The agent:

1. Asks structured, probing questions to extract:
   - **Concepts** — what are the key abstractions? What parts make up the whole?
   - **Constraints** — what rules, invariants, conditions must hold? When do they apply?
   - **Decisions** — what was decided, and why? What alternatives were considered?
   - **Claims** — what assertions are made? Are they agreed or still tentative?
   - **Scope** — where/when does each rule or decision apply?

2. Tracks consensus — a topic is "done" when:
   - All key concepts are named and described
   - All constraints have `condition` and `invariant` defined
   - All decisions have `rationale` and `scope`
   - All active claims have `confidence: agreed`

3. Writes nodes incrementally to `$PROJECT_ROOT/.grasp-it/intermediate/po-nodes.json`:
```json
{
  "nodes": [
    { "id": "concept:<name>", "type": "concept", "name": "...", "summary": "...", "tags": [], "complexity": "moderate", "subConcepts": [], "constrainedBy": [] },
    { "id": "decision:<name>", "type": "decision", "name": "...", "summary": "...", "rationale": "...", "status": "proposed", "scope": [], "tags": [], "complexity": "moderate" },
    { "id": "constraint:<name>", "type": "constraint", "name": "...", "condition": "...", "invariant": "...", "scope": [], "tags": [], "complexity": "simple" }
  ]
}
```

4. Writes edges to `$PROJECT_ROOT/.grasp-it/intermediate/po-edges.json`:
```json
{
  "edges": [
    { "source": "decision:<name>", "target": "concept:<name>", "type": "implements", "direction": "forward", "weight": 1.0 },
    { "source": "concept:<name>", "target": "constraint:<name>", "type": "constrained_by", "direction": "forward", "weight": 1.0 },
    { "source": "claim:<uuid>", "target": "decision:<name>", "type": "decides", "direction": "forward", "weight": 0.8 }
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
6. **Evidence** — Is there documentation, a ticket, or code that shows this?

For each question, mark the response as `tentative` or `agreed`. Switch to `agreed` only when the PO confirms and you paraphrase back their meaning and they confirm your paraphrase is correct.

---

## Phase 3: Consensus Check

Periodically (or when the PO signals done), verify mutual understanding:

1. Summarize back what was agreed in the conversation:
   - List the key concepts and their sub-concepts
   - List the constraints with their invariants
   - List the decisions with their rationale and scope
   - List any claims that are still tentative

2. Ask: "Have I understood this correctly? Is there anything I've missed or misrepresented?"

3. If the PO confirms, mark all current claims as `confidence: agreed`, set all current decisions to `status: accepted`

4. If gaps remain, continue interviewing until consensus

---

## Phase 4: Merge into Knowledge Graph

1. Read the existing `$PROJECT_ROOT/.grasp-it/knowledge-graph.json` (if it exists)
2. Read the new `po-nodes.json` and `po-edges.json`
3. Merge:
   - Nodes with the same `id` are deduplicated (keep existing if already `accepted` or `implemented`, otherwise update)
   - Edges are deduplicated by `(source, target, type)` composite
   - All new nodes/edges are appended
4. Ensure a `layer:knowledge` layer exists — add any new PO-derived nodes to its `nodeIds`
5. Validate the merged graph using the schema validation
6. Write the merged graph back to `$PROJECT_ROOT/.grasp-it/knowledge-graph.json`

---

## Phase 5: Summary

Report to the user:
- Topics covered
- Decisions extracted (with rationale)
- Constraints extracted (with invariants)
- Concepts extracted (with sub-concept hierarchy)
- Any gaps or open questions remaining
- Path to the updated graph

Offer to launch the dashboard:

> Run `/grasp-dashboard` to view the updated knowledge graph.

---

## Reference: PO Interview Node Shapes

```
Decision node:
{
  "id": "decision:<kebab-name>",
  "type": "decision",
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
  "name": "<name>",
  "condition": "<when this applies>",
  "invariant": "<what must hold true>",
  "scope": ["auth"],
  "tags": ["security"],
  "complexity": "simple"
}

Concept node (conversation-extended):
{
  "id": "concept:<kebab-name>",
  "type": "concept",
  "name": "<name>",
  "summary": "<description>",
  "sub_concept_of": ["concept:<sub-part>"],
  "constrained_by": ["constraint:<rule-id>"],
  "tags": [],
  "complexity": "moderate"
}

Claim node (conversation-extended):
{
  "id": "claim:<short-uuid>",
  "type": "claim",
  "name": "<name>",
  "summary": "<the assertion>",
  "confidence": "agreed",
  "rationale": "<evidence or reasoning>",
  "tags": [],
  "complexity": "simple"
}
```
