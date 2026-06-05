# Task 47: Update `po-interviewer` agent with `kind`/`source`, Risk node format, and new edge examples

## Background

The `po-interviewer` agent is invoked by `/grasp-requirements` during structured specialist
interviews. Three gaps were found:

1. Node output templates are missing `kind: "knowledge"` and `source: "interview"`
2. No Risk node output format is defined, even though the SKILL.md documents risk extraction
3. The edge examples are missing `has_risk` and `mitigated_by` relationship types

This means even though the `/grasp-requirements` SKILL.md correctly describes risk extraction,
the agent executing the interview won't produce risk nodes or risk-related edges — there's nothing
in the agent's instructions telling it how to format them.

## File to change

`grasp-it-plugin/agents/po-interviewer.md`

## Required changes

Read the file fully before editing.

### 1. Add `kind` and `source` to all existing node templates

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

- Every existing node type example in `po-interviewer.md` includes `"kind": "knowledge"` and
  `"source": "interview"`
- A complete Risk node template is present with all required properties
- The edges section includes `has_risk` and `mitigated_by` examples
- The agent instructions explain when to create a Risk node
- No regressions to existing concept, decision, constraint, claim node formats

## References

- `docs/architecture/neo4j-schema.md` — PO Interview Layer section (Risk node definition)
- `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — Phase 2 risk probing, Phase 5 risk
  summary, Risk node shape in reference section
- Related tasks: 43 (core types for `risk` type and `has_risk`/`mitigated_by`), 46 (domain-analyzer), 49 (tests)
