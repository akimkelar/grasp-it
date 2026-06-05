# Task 48: Update `grasp-domain` skill to document `source: "code-analysis"` requirement

## Background

The `/grasp-domain` skill mines business domain knowledge from codebase signals and produces
knowledge graph nodes. The schema (see `docs/architecture/neo4j-schema.md`) requires all nodes
produced by this skill to carry `source: "code-analysis"` and `kind: "knowledge"`.

However, the `grasp-domain/SKILL.md` documentation is silent on this requirement. The skill's
instructions do not tell the domain-analyzer agent to set these properties. When a user reads the
skill to understand how it works, or when an LLM processes the skill definition, there is no
indication that `source` must be set.

The fix in Task 46 updates the agent template; this task updates the skill's own documentation
to be the authoritative, readable statement of the requirement.

## File to change

`grasp-it-plugin/skills/grasp-domain/SKILL.md`

## Required changes

Read the file fully before editing. Find the section that describes the graph output format or
the knowledge extraction phase. Add a clearly visible note, similar to what exists in
`grasp-requirements/SKILL.md` (lines 20–22):

> **All nodes created by this skill carry `kind: "knowledge"` and `source: "code-analysis"`.** This
> distinguishes code-mined knowledge from specialist-described knowledge (`source: "interview"`)
> and enables queries that separate implemented facts from planned intent.

Place this note at the start of the Graph Schema section (or equivalent section that describes
what nodes the skill produces).

If the skill has a phase that assembles or writes the knowledge graph, add a reminder there too:
all nodes written to `knowledge-graph.json` by this skill must include `"kind": "knowledge"` and
`"source": "code-analysis"`.

If there are example node JSON shapes in the skill file, update them to include both properties.

## Acceptance criteria

- The skill file explicitly states that all produced nodes carry `source: "code-analysis"` and
  `kind: "knowledge"`
- Any example node JSON in the file includes these two fields
- No functional changes to the skill's interview logic or phase structure

## References

- `docs/architecture/neo4j-schema.md` — Shared Node Properties (source property), Business Layer
  table (confirms `/grasp-domain` produces `source: "code-analysis"`)
- `docs/architecture/schema-evolution-plan.md` — Knowledge source tracking section
- `grasp-it-plugin/skills/grasp-requirements/SKILL.md` — lines 20–22 for the equivalent note in
  the requirements skill (use as a template)
- Related tasks: 46 (domain-analyzer agent), 47 (po-interviewer agent)
