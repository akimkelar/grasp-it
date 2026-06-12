# Graph Visual Style Guide

This document defines the visual styling for the Neo4j Browser graph.
Apply it via `:style` in Neo4j Browser — drag `graph-style.grass` onto the panel.

---

## Design Principles

### Size — encodes conceptual importance

| Tier | Nodes | Diameter | Rationale |
|------|-------|----------|-----------|
| 1 | `Domain` | 60px | Root anchor — everything hangs from here |
| 2 | `Feature` | 52px | Primary product unit |
| 3 | `BusinessRule` | 44px | High-level business policy |
| 4 | `Decision` | 40px | Resolved question |
| 5 | `Actor` | 38px | User role or system agent |
| 6 | `Operation` | 36px | Action within a feature |
| 7 | `Entity`, `Risk`, `Constraint` | 32px | Normal size — concrete artifacts and danger nodes |
| 8 | `Concept`, `Claim` | 26–28px | Interview-specific abstractions |
| 9 | `Class` | 34px | Codebase — most important structural node |
| 10 | `Function` | 28px | Codebase — function definition |
| 11 | `Module` | 24px | Codebase — module or namespace |
| 12 | `File`, `Config`, `Table`, `Endpoint` | 16–22px | Codebase — smaller structural/resource nodes |

### Node color — three semantic layers on a dark canvas (`#0F172A`)

All node colors sit at the same perceptual lightness (~50% HSL), so gradients within each area are driven purely by hue — not brightness. Every node reads equally well on the dark background.

**Codebase Layer** — yellow-green to teal (hue 90° → 160°)
Codebase nodes span from bright yellow-green (File) through forest green (Function, Class) to deep teal (Endpoint). The border uses a lighter version of each node's own hue to create visible contrast while staying within the green family.

`Class` (CL-1, most important) → `Function` (CL-2) → `File` (CL-3) → `Module` (CL-4) → `Config` (CL-5) → `Table` (CL-6) → `Endpoint` (CL-7)

**Knowledge Code-Analysis Layer** — violet to blue (hue 260° → 220°)
Knowledge nodes from code analysis use violet-to-blue gradient. Domain is violet, gradient deepens toward blue as importance decreases. **Border: lighter violet** (`#C490F0` family) distinguishes code-analysis source.

`Domain` (KA-1, violet) → `Feature` (KA-2, blue-violet) → `BusinessRule` (KA-3, cornflower blue) → `Actor` (KA-4) → `Operation` (KA-5) → `Entity` (KA-6) → `Risk` (KA-7, danger) → `Constraint` (KA-8, danger)

**Knowledge Interview Layer** — rose to pink (hue 328° → 348°)
Interview-derived nodes use rose-pink tones. **Border: lighter pink** (`#E890B0` family) distinguishes interview source. Note: Decision, Concept, Claim appear ONLY from interviews.

`Decision` (KI-1, rose) → `Concept` (KI-2) → `Claim` (KI-3)

**Danger nodes** — rose-pink to amber (hue 328° → 46°)
Risk and Constraint nodes appear in both code-analysis and interview layers but maintain their danger spectrum colors for immediate recognition.

`Risk` (DA-1, rose-pink) → `Constraint` (DA-2, orange-red)

### Relationship color — mirrors the semantic group

| Group | Relationships | Color | Width |
|-------|--------------|-------|-------|
| **Backbone** | `HAS_FEATURE`, `HAS_OPERATION`, `DEPENDS_ON` | `#555555` | 2px |
| **Codebase** | `CONTAINS`, `IMPORTS`, `EXPORTS`, `INHERITS`, `IMPLEMENTS`, `CALLS`, `READS_FROM`, `WRITES_TO`, `CONFIGURES`, `TESTED_BY` | `#3A9E6A` | 1px |
| **Knowledge** | `SEQUENCE`, `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY`, `DECIDES`, `SUB_CONCEPT_OF`, `IMPLEMENTS`, `SUPPORTS`, `APPLIES_IN`, `HAS_RISK`, `MITIGATED_BY` | `#4A7AAE` | 1px |
| **Bridge** | `IMPLEMENTED_BY` | `#9A6AC8` | 2px |
| **Interview** | `CONSTRAINED_BY` | `#C87098` | 1px |

---

## Color Reference

### Canvas

| Property | Value |
|----------|-------|
| Background | `#0F172A` |
| Section dividers | `#1E293B` |
| Muted label text | `#94A3B8` |
| Node label text (codebase — green) | `#E8F8E8` |
| Node label text (knowledge — blue) | `#E8EEFF` |
| Node label text (interview — pink) | `#FFE8F2` |
| Node label text (danger) | `#FFE8F2` |

### Nodes

#### Codebase Layer — yellow-green to teal (hue 90° → 160°), yellow-green border

| ID | Node | Fill | Stroke | Diameter | Description |
|----|------|------|--------|----------|-------------|
| CL-1 | `Class` | `#3A8A4A` | `#88C088` | 34px | Sage green — most important |
| CL-2 | `Function` | `#5A9E5A` | `#98D898` | 28px | Green — function definition |
| CL-3 | `File` | `#70B860` | `#B8E098` | 22px | Yellow-green — source file |
| CL-4 | `Module` | `#2A7A3A` | `#78B078` | 24px | Dark green — module/namespace |
| CL-5 | `Config` | `#1A6A2A` | `#68A068` | 20px | Olive green — configuration file |
| CL-6 | `Table` | `#0A5A1A` | `#589058` | 18px | Dark teal — database table |
| CL-7 | `Endpoint` | `#004A0A` | `#488048` | 16px | Teal — HTTP endpoint |

#### Knowledge Code-Analysis Layer — violet to aqua (hue 260° → 190°), lighter violet border

| ID | Node | Fill | Stroke | Description |
|----|------|------|--------|-------------|
| KA-1 | `Domain` | `#5E1EC4` | `#C490F0` | Violet — product domain |
| KA-2 | `Feature` | `#4833C4` | `#A890E8` | Blue-violet — product feature |
| KA-3 | `BusinessRule` | `#3D3DC4` | `#9898E8` | Cornflower blue — business policy |
| KA-4 | `Operation` | `#1858B8` | `#6898D8` | Blue — action within feature |
| KA-5 | `Entity` | `#1848B0` | `#6088D0` | Cornflower — business object |
| KA-6 | `Actor` | `#2090B8` | `#70C0D8` | Aqua — user role |
| KA-7 | `Risk` | `#C4426E` | `#E898B4` | Rose-pink — danger node |
| KA-8 | `Constraint` | `#D04E3A` | `#F09880` | Orange-red — danger node |

#### Knowledge Interview Layer — rose (hue 328° → 348°), lighter pink border

| ID | Node | Fill | Stroke | Description |
|----|------|------|--------|-------------|
| KI-1 | `Decision` | `#C44878` | `#E890B0` | Rose — resolved question |
| KI-2 | `Concept` | `#C04070` | `#E080A0` | Pink-rose — specialist abstraction |
| KI-3 | `Claim` | `#BC3868` | `#D87090` | Rose — interview assertion |

#### Knowledge Interview Layer — rose (hue 328° → 348°), pink border

| ID | Node | Fill | Stroke | Description |
|----|------|------|--------|-------------|
| KI-1 | `Decision` | `#C44878` | `#E890B0` | Rose — resolved question |
| KI-2 | `Concept` | `#C04070` | `#E080A0` | Pink-rose — specialist abstraction |
| KI-3 | `Claim` | `#BC3868` | `#D87090` | Rose — interview assertion |

### Relationships

| Relationship | Hex | Width | Group |
|-------------|-----|-------|-------|
| `HAS_FEATURE`, `HAS_OPERATION`, `DEPENDS_ON` | `#555555` | 2px | Backbone |
| `CONTAINS`, `IMPORTS`, `EXPORTS`, `INHERITS`, `IMPLEMENTS` | `#3A9E6A` | 1px | Codebase |
| `CALLS`, `READS_FROM`, `WRITES_TO`, `CONFIGURES`, `TESTED_BY` | `#3A9E6A` | 1px | Codebase |
| `SEQUENCE`, `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY` | `#4A7AAE` | 1px | Knowledge |
| `DECIDES`, `SUB_CONCEPT_OF`, `IMPLEMENTS`, `SUPPORTS`, `APPLIES_IN`, `HAS_RISK`, `MITIGATED_BY` | `#4A7AAE` | 1px | Knowledge |
| `IMPLEMENTED_BY` | `#9A6AC8` | 2px | Bridge |
| `CONSTRAINED_BY` | `#C87098` | 1px | Interview |
