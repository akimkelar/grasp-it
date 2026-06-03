# Task 14: Update knowledge-graph-guide Agent for New Schema

## Description

The `knowledge-graph-guide` agent (`grasp-it-plugin/agents/knowledge-graph-guide.md`) is
completely out of date after the schema changes introduced in Task 5. It still references
the old `Flow`/`Step` node types, `contains_flow`/`flow_step`/`cross_domain` edge types,
and the old three-level domain hierarchy. Users who invoke this agent will receive
incorrect guidance about graph structure.

## Pre-requisites

- Task 5 (schema node updates) complete ✓
- Task 10 (graph-reviewer update) complete ✓

## Current state (stale)

**Node types listed (16 total — stale):**
Includes `flow` and `step`; does NOT include `feature`, `actor`, `business-rule`,
`operation`, `entity`, `decision`, `constraint`.

**Edge types listed (29 total — stale):**
Includes `contains_flow`, `flow_step`, `cross_domain`; does NOT include
`has_feature`, `has_operation`, `sequence`, `performed_by`, `restricted_for`,
`governs`, `uses_entity`, `implemented_by`, `constrained_by`, `decides`.

**Domain Graph Specifics section (stale):**
Describes `Domain → Flow → Step` hierarchy which no longer exists.

## Actions

### 14.1 Update node types table

**File:** `grasp-it-plugin/agents/knowledge-graph-guide.md`

Replace the node types table (currently "16 total: 5 code + 8 non-code + 3 domain") with:

**21 node types total: 7 codebase + 8 knowledge + 6 structural**

Codebase nodes (7):
| `file` | `file:<relative-path>` | Source file |
| `function` | `function:<relative-path>:<name>` | Function or method |
| `class` | `class:<relative-path>:<name>` | Class, interface, or type |
| `module` | `module:<name>` | Logical module or package |
| `config` | `config:<relative-path>` | Configuration file |
| `table` | `table:<relative-path>:<table-name>` | Database table |
| `endpoint` | `endpoint:<relative-path>:<name>` | API endpoint |

Knowledge nodes (8):
| `domain` | `domain:<kebab-case-name>` | Business domain |
| `feature` | `feature:<kebab-case-name>` | Business feature within a domain |
| `actor` | `actor:<kebab-case-name>` | Human or system actor |
| `business-rule` | `business-rule:<kebab-case-name>` | Business constraint or rule |
| `operation` | `operation:<kebab-case-name>` | Business operation within a feature |
| `entity` | `entity:<kebab-case-name>` | Domain entity (data object) |
| `decision` | `decision:<kebab-case-name>` | Architecture decision |
| `constraint` | `constraint:<kebab-case-name>` | Architecture constraint |

Structural nodes (6):
| `concept` | `concept:<name>` | Abstract concept or pattern |
| `document` | `document:<relative-path>` | Documentation file |
| `service` | `service:<relative-path>` | Dockerfile, docker-compose, K8s manifest |
| `pipeline` | `pipeline:<relative-path>` | CI/CD pipeline |
| `schema` | `schema:<relative-path>` | GraphQL, Protobuf, Prisma schema |
| `resource` | `resource:<relative-path>` | Terraform, CloudFormation resource |

Remove `flow` and `step` rows entirely.

### 14.2 Update edge types table

Replace the edge types table (currently "29 total in 7 categories") with:

**36 edge types total: 26 structural + 10 knowledge**

Update the Domain category row:
- Old: `contains_flow`, `flow_step`, `cross_domain`
- New (Knowledge category): `has_feature`, `has_operation`, `sequence`, `performed_by`,
  `restricted_for`, `governs`, `uses_entity`, `implemented_by`, `constrained_by`, `decides`

Rename the category from "Domain" to "Knowledge".

### 14.3 Update Domain Graph Specifics section

Replace the old three-level hierarchy description with the new schema:

**Old (remove):**
- Domain nodes contain Flow nodes via `contains_flow` edges
- Flow nodes contain Step nodes via `flow_step` edges (weight encodes order: 0.1, 0.2, etc.)
- Domain nodes connect to each other via `cross_domain` edges
- domainMeta field description

**New (write):**
- Domain nodes group Features via `has_feature` edges
- Feature nodes group Operations via `has_operation` edges
- Operations can be ordered via `sequence` edges (Operation → Operation)
- Actors perform operations via `performed_by` edges (Operation → Actor)
- Actors may be restricted from operations via `restricted_for` edges (Operation → Actor)
- BusinessRules govern Features or Operations via `governs` edges
- Features and Operations reference domain entities via `uses_entity` edges
- Features and Operations link to code nodes via `implemented_by` edges (status: legacy/target/shared/planned)
- Decisions and Constraints connect to Features/Operations via `decides` and `constrained_by` edges

### 14.4 Update the "Domain analysis" help tip

In the "How to Help Users" section, point 6:
- Old: `jq '.nodes[] | select(.type == "flow")' domain-graph.json`
- New: `jq '.nodes[] | select(.type == "feature")' domain-graph.json`
- Update description from "business flows and processes" to "business features, operations, and actors"

### 14.5 Update node count in section header

Update the section header from:
`### Node Types (16 total: 5 code + 8 non-code + 3 domain)`
to:
`### Node Types (21 total: 7 codebase + 8 knowledge + 6 structural)`

And edge types:
`### Edge Types (29 total in 7 categories)` → `### Edge Types (36 total in 7 categories)`
(or restructure categories to match structural/knowledge split)

## Completion

When complete:
- `knowledge-graph-guide.md` lists new node types (feature, actor, business-rule, operation, entity, decision, constraint); no `flow` or `step`
- `knowledge-graph-guide.md` lists new knowledge edge types; no `contains_flow`, `flow_step`, `cross_domain`
- Domain Graph Specifics section describes the new hierarchy (Domain → Feature → Operation)
- Commit with message: `docs: update knowledge-graph-guide for new schema (Feature/Actor/BusinessRule/Operation/Entity)`
- Push to remote
