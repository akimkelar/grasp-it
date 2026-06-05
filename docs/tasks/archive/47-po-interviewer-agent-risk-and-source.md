# Task 47: Update `po-interviewer` agent — fix file naming, clarify role, add `kind`/`source` and Risk support

## Background

The `/grasp-requirements` skill was rewritten. The interview protocol is now **fully inline** in
the skill — the skill no longer delegates the interview to `po-interviewer`. This creates two
distinct issues:

**Issue 1 — File naming mismatch:** The agent currently writes to `po-nodes.json` and
`po-edges.json`. The skill reads from `pr-nodes.json` and `pr-edges.json`. If the agent is
ever used for graph writing (Phase 5), its output is invisible to the skill.

**Issue 2 — Missing content:** Even if the agent is repurposed (see below), its templates lack:
1. `kind: "knowledge"` and `source: "interview"` on all node outputs
2. Risk node output format
3. `has_risk` and `mitigated_by` edge examples

## Agent's new role

The `po-interviewer` agent should be **repurposed as a graph-writing helper**. The skill
conducts the interview inline (directly in the conversation); the agent handles the mechanical
work of serializing the gathered knowledge into the intermediate graph files. This is a clean
separation: interview logic in the skill, serialization logic in the agent.

Update the agent's description and instructions to reflect this:
- Old role: "conduct the structured interview"
- New role: "take the interview context produced during a `/grasp-requirements` session and
  serialize it into `pr-nodes.json` and `pr-edges.json`"

## File to change

`grasp-it-plugin/agents/po-interviewer.md`

## Required changes

Read the file fully before editing.

### 0. Fix file naming

Replace all occurrences of `po-nodes.json` with `pr-nodes.json` and `po-edges.json` with
`pr-edges.json`. These are the canonical intermediate file names used by the skill.

### 1. Update agent description and purpose

Rewrite the agent's purpose statement to: the agent is a **graph serialization helper** invoked
after each interview aspect (or at the end of the session) to write discovered nodes and edges to
`pr-nodes.json` and `pr-edges.json`. The agent does NOT conduct interviews — it only formats and
persists knowledge that was already gathered in conversation.

### 2. Add `kind` and `source` to all existing node templates

Every existing node output example (concept, decision, constraint, claim) must gain:

```json
"kind": "knowledge",
"source": "interview"
```

Add a note in the output format section stating that ALL nodes produced by this agent must carry
these two fields.

### 2. Add Risk node output format

Add a `risk` node template alongside the existing node type examples:

```json
{
  "id": "risk:<kebab-name>",
  "type": "risk",
  "kind": "knowledge",
  "source": "interview",
  "name": "<human-readable name>",
  "summary": "<what could go wrong and why it matters>",
  "severity": "low|medium|high|critical",
  "probability": "low|medium|high",
  "mitigation": "<how this risk is or could be addressed — empty string if unknown>",
  "scope": ["<feature-or-domain-name>"],
  "tags": []
}
```

Clarify:
- `severity` values: `"low"` | `"medium"` | `"high"` | `"critical"`
- `probability` values: `"low"` | `"medium"` | `"high"`
- `mitigation` is optional — set to `""` if no mitigation is known yet

### 3. Add `has_risk` and `mitigated_by` edge examples

In the edges output section, add:

```json
{ "source": "feature:<id>", "target": "risk:<id>", "type": "has_risk", "direction": "forward", "weight": 1.0 },
{ "source": "operation:<id>", "target": "risk:<id>", "type": "has_risk", "direction": "forward", "weight": 1.0 },
{ "source": "risk:<id>", "target": "decision:<id>", "type": "mitigated_by", "direction": "forward", "weight": 0.9 },
{ "source": "risk:<id>", "target": "constraint:<id>", "type": "mitigated_by", "direction": "forward", "weight": 0.9 }
```

## When the agent should create Risk nodes

The agent should create a `risk` node whenever the specialist:
- Warns about what could go wrong if the feature is implemented incorrectly
- Describes edge cases in calculation logic (e.g., rounding, ordering, concurrency)
- Describes customer-facing exposure from a wrong implementation choice
- Describes data-loss hazards during migration or refactoring
- Describes scenarios where rules interact unexpectedly

## Acceptance criteria

- Agent description clearly states its role as a graph-writing helper (not an interviewer)
- All references to `po-nodes.json` and `po-edges.json` replaced with `pr-nodes.json` and `pr-edges.json`
- Every existing node type example includes `"kind": "knowledge"` and `"source": "interview"`
- A complete Risk node template is present with all required properties
- The edges section includes `has_risk` and `mitigated_by` examples
- The agent instructions explain when to create a Risk node
- No regressions to existing concept, decision, constraint, claim node formats

## References

- `docs/architecture/neo4j-schema.md` — PO Interview Layer section (Risk node definition)
- `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — Phase 2 risk probing, Phase 5 risk
  summary, Risk node shape in reference section
- Related tasks: 43 (core types for `risk` type and `has_risk`/`mitigated_by`), 46 (domain-analyzer), 49 (tests)
