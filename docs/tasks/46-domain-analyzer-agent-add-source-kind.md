# Task 46: Update `domain-analyzer` agent to emit `kind` and `source` on all produced nodes

## Background

The `domain-analyzer` agent is invoked by `/grasp-domain` to mine business knowledge from
codebase signals. It produces knowledge graph nodes (`Domain`, `Feature`, `Operation`, `Actor`,
`BusinessRule`, `Entity`) but its output template examples do NOT include `kind: "knowledge"` or
`source: "code-analysis"` on any node.

The schema (see `docs/architecture/neo4j-schema.md`, Shared Node Properties) requires every
knowledge node to carry both these fields. Without them, nodes produced by this agent will be
missing the metadata that distinguishes code-mined knowledge from interview-derived knowledge.

## File to change

`grasp-it-plugin/agents/domain-analyzer.md`

## Required changes

Read the file fully before editing. Find every place where the agent's output format is defined
or example node JSON is shown. For each node template, add:

```json
"kind": "knowledge",
"source": "code-analysis"
```

The agent produces nodes of these types — all need the two new fields:
- `domain`
- `feature`
- `operation`
- `actor`
- `business-rule`
- `entity`

### Example: before

```json
{
  "id": "domain:invoicing",
  "type": "domain",
  "name": "Invoicing",
  "summary": "Handles the invoicing lifecycle",
  "tags": ["core"],
  "complexity": "complex"
}
```

### Example: after

```json
{
  "id": "domain:invoicing",
  "type": "domain",
  "kind": "knowledge",
  "source": "code-analysis",
  "name": "Invoicing",
  "summary": "Handles the invoicing lifecycle",
  "tags": ["core"],
  "complexity": "complex"
}
```

Also add a note at the top of the output format section (or in the instructions section) that
all nodes this agent produces must carry `kind: "knowledge"` and `source: "code-analysis"`.

## Acceptance criteria

- Every node example in `domain-analyzer.md` includes `"kind": "knowledge"` and
  `"source": "code-analysis"`
- The agent instructions explicitly state these two fields are required on every output node
- No other functional changes to the agent prompt

## References

- `docs/architecture/neo4j-schema.md` — Shared Node Properties section, Business Layer section
  (confirms `/grasp-domain` produces `source: "code-analysis"`)
- `docs/architecture/schema-evolution-plan.md` — Knowledge source tracking section
- Related tasks: 47 (po-interviewer agent), 48 (grasp-domain skill), 49 (tests)
