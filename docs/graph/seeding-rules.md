# Graph Seeding Rules

## Overview

Seeding generates an initial useful graph from a codebase. The goal is not just a reference index (which files reference which) — it is a graph useful for **reasoning about business logic and constraints**.

## What Seeding Produces

### From `/grasp` (codebase structure)

- File tree with complexity scores
- Function, class, module, endpoint facts
- Call graph (function → function edges)
- Import graph (file → file edges)
- Config and table facts

### From `/grasp-domain` (code analysis)

- `Domain` nodes from entry point groupings and directory structure
- `Feature` nodes from URL paths, controller names, directory layout signals
- `Operation` nodes from HTTP endpoints, exported handler names, event handlers
- Draft `BusinessRule` nodes from guard and permission patterns in code
- `Actor` hints from role-related naming (limited — true actor definition requires PO)
- `Entity` nodes from business object naming patterns
- `Risk` nodes from code-visible hazards (float arithmetic, external API calls, complex time-boundary conditionals, missing validation on critical paths)
- `Constraint` nodes from interface contracts, validation guards, and access control invariants

### From `/grasp-interview` (PO interview)

- `Feature` descriptions with `status: "planned"`
- `Actor` definitions with `permissions` and `restrictions`
- `BusinessRule` nodes confirmed and enriched with `ruleText`
- `Decision` nodes with `rationale`
- `Constraint` nodes with `condition` and `invariant`
- `Operation` sequences with ordering and conditions

## Seeding Quality Bar

A well-seeded graph from a new codebase meets these criteria:

| Criterion | Minimum | Good |
|-----------|---------|------|
| Domains identified | 2 | 4+ |
| Features per domain | 1 | 3+ |
| Features with `summary` | all | all with meaningful summaries |
| Operations per feature | 1 | 3+ |
| Operations with business-meaningful names | 50% | 80%+ |
| Actors identified | 0 | 2+ (if roles exist in codebase) |
| BusinessRules surfaced | 0 | 1+ (from guard patterns) |
| `IMPLEMENTED_BY` edges | all features | all features with confidence >= 0.6 |
| Knowledge nodes with `generatedAt` | all | all with valid ISO timestamps |
| Knowledge nodes with `sourceCommit` (code-analysis only) | all | all with valid git hashes |

## What Makes Seeding Fail

### Too few entry points detected

If the entry point patterns miss the framework's routing conventions, the domain-analyzer receives little signal and produces generic/empty features.

**Mitigation:** Add framework-specific entry point patterns (e.g., Grails controller methods, Spring annotations). This is why Task 4 (Groovy/Grails support) must precede seeding for Grails codebases.

### No business-looking names

If all files and functions are named technically (`util.ts`, `helper.js`, `process()`), the domain-analyzer cannot infer business intent.

**Mitigation:** Good seeding requires the codebase to use domain terminology in its naming. This is a project-level convention, not something the tool can fix.

### Trivial summaries

If the LLM produces summaries like "This is a function that processes data", the graph is not useful for reasoning.

**Mitigation:** Improve the domain-analyzer prompt to require specific, meaningful summaries. Consider adding a minimum summary length or requiring specific details (what business concept this implements).

### Low `IMPLEMENTED_BY` confidence

When the mapping between business concept and code is uncertain, confidence is low.

**Mitigation:** More entry point signals (URL paths, handler names) help the LLM make confident mappings. Ensure file names and function names reflect business intent.

## Identity and Metadata Rules

### Stable identity

- seed and update business nodes by stable `key`
- prefer `MERGE` by `key` for graph updates
- derive keys from meaning, not from file layout alone

### Common metadata

The following fields should be treated as the default metadata set for knowledge graph nodes:

- `key`
- `name`
- `summary`
- `generatedAt` (ISO 8601 timestamp — when the node was created or last refreshed)
- `sourceCommit` (git hash — commit at which this node was derived from code; omit for interview-derived nodes)
- `status`
- `sourceFiles`

### Source priority

1. code, especially active and legacy production code
2. Jira, Confluence, ADRs, and curated migration notes
3. local docs and investigations

When sources conflict, prefer active code unless:

- the code is clearly dead or superseded
- a target path is newer and explicitly chosen by decision evidence
- parity is marked as `intentional-difference`

## Seeding and Language Support

The quality of seeding is directly tied to language support. The more languages the extraction pipeline understands, the more entry points are discovered and the richer the signals available to the domain-analyzer.

Current language support:
- JavaScript/TypeScript — full
- Python — full
- Java — partial (tree-sitter grammar exists, import resolver wired)
- Kotlin — partial
- Ruby — partial
- PHP — partial
- C# — partial
- C/C++ — partial
- **Groovy — not yet supported** (Task 4 addresses this)

## Seeding vs Incremental Updates

Seeding is the initial graph creation. After seeding, the graph is updated incrementally:

- `/grasp` rebuilds the codebase subgraph (deterministic, script-only)
- `/grasp-domain` updates domain/feature/operation knowledge (LLM, from script signals)
- `/grasp-interview` adds or updates PO interview knowledge (LLM, from PO input)

The graph is never fully deleted and rebuilt from scratch — only the codebase subgraph is wiped per `/grasp` run. Knowledge subgraph persists and is updated incrementally.

## Seeding the Right Graph

A search index tells you "where is this string referenced." A useful knowledge graph tells you "what does this feature do, who performs it, what rules govern it, and where is it implemented."

Seeding must produce the latter. If the graph only answers reference queries, it has failed its purpose. The seeding rules above ensure the graph is rich enough to support business reasoning, not just code search.