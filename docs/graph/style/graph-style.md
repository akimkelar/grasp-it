# Graph Visual Style Guide

This document defines the visual styling for the Neo4j Browser graph.
Apply it via `:style` in Neo4j Browser — drag `graph-style.grass` onto the panel.

---

## Design Principles

### Size — encodes hierarchy, codebase is smaller than knowledge

Knowledge nodes (32–60px) are larger than codebase nodes (10–26px) to visually distinguish the two layers — knowledge represents business concepts that span multiple files, while codebase represents implementation details.

Within each layer, size reflects structural importance:

**Codebase** (larger aggregate → smaller leaf):
`Module` (26px) → `File` (22px) → `Class` (20px) → `Function` (16px) → `Config` (14px) → `Table` (12px) → `Endpoint` (10px)

**Knowledge** (tier 1–8, top-level → granular):
`Domain` (60px) → `Feature` (52px) → `BusinessRule` (44px) → `Decision` (40px) → `Actor` (38px) → `Operation` (36px) → `Entity/Risk/Constraint` (32px) → `Concept/Claim` (26–28px)

| Tier | Nodes | Diameter |
|------|-------|----------|
| 1 | `Domain` | 60px |
| 2 | `Feature` | 52px |
| 3 | `BusinessRule` | 44px |
| 4 | `Decision` | 40px |
| 5 | `Actor` | 38px |
| 6 | `Operation` | 36px |
| 7 | `Entity`, `Risk`, `Constraint` | 32px |
| 8 | `Concept`, `Claim` | 26–28px |
| 9 | `Module` | 26px |
| 10 | `File` | 22px |
| 11 | `Class` | 20px |
| 12 | `Function` | 16px |
| 13 | `Config` | 14px |
| 14 | `Table` | 12px |
| 15 | `Endpoint` | 10px |
| 16 | `Document`, `Service`, `Pipeline`, `Schema`, `Resource` | 10–18px |

### Node color — hue encodes both layer and hierarchy on a dark canvas (`#0F172A`)

**Codebase Layer** — blue-green to yellow-green (hue 170° → 68°)
Hue varies by structural size: larger/aggregate nodes (Module) start at mossy blue-green (170°), smaller/leaf nodes (Endpoint) end at yellow-green (68°). This creates an intuitive visual where "warmer" (more yellow-green) = smaller implementation detail.

`Module` (CL-0, teal, 170°) → `File` (CL-1, 153°) → `Class` (CL-2, 136°) → `Function` (CL-3, 119°) → `Config` (CL-4, 102°) → `Table` (CL-5, 85°) → `Endpoint` (CL-6, 68°)

**Knowledge Code-Analysis Layer** — violet to blue (hue 260° → 220°)
Domain is violet, gradient deepens toward blue as importance decreases. **Border: lighter violet** (`#C490F0` family) distinguishes code-analysis source.

`Domain` (KA-1, violet) → `Feature` (KA-2, blue-violet) → `BusinessRule` (KA-3, cornflower blue) → `Actor` (KA-4) → `Operation` (KA-5) → `Entity` (KA-6) → `Risk` (KA-7, danger) → `Constraint` (KA-8, danger)

**Knowledge Concept Layer** — rose to pink (hue 328° → 348°)
Concept-derived nodes use rose-pink tones. **Border: lighter pink** (`#E890B0` family) distinguishes concept source. Note: Decision, Concept, Claim appear ONLY from concept plans.

`Decision` (KI-1, rose) → `Concept` (KI-2) → `Claim` (KI-3)

**Danger nodes** — rose-pink to amber (hue 328° → 46°)
Risk and Constraint nodes appear in both code-analysis and concept layers but maintain their danger spectrum colors for immediate recognition.

`Risk` (DA-1, rose-pink) → `Constraint` (DA-2, orange-red)

### Relationship color — mirrors the semantic group

| Group | Relationships | Color | Width |
|-------|--------------|-------|-------|
| **Backbone** | `HAS_FEATURE`, `HAS_OPERATION`, `DEPENDS_ON` | `#555555` | 2px |
| **Codebase** | `CONTAINS`, `IMPORTS`, `EXPORTS`, `INHERITS`, `IMPLEMENTS`, `CALLS`, `READS_FROM`, `WRITES_TO`, `CONFIGURES`, `TESTED_BY` | `#3A9E6A` | 1px |
| **Knowledge** | `SEQUENCE`, `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY`, `DECIDES`, `SUB_CONCEPT_OF`, `IMPLEMENTS`, `SUPPORTS`, `APPLIES_IN`, `HAS_RISK`, `MITIGATED_BY` | `#4A7AAE` | 1px |
| **Bridge** | `IMPLEMENTED_BY` | `#9A6AC8` | 2px |
| **Concept** | `CONSTRAINED_BY` | `#C87098` | 1px |

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
| Node label text (concept — pink) | `#FFE8F2` |
| Node label text (danger) | `#FFE8F2` |

### Nodes

#### Codebase Layer — teal to yellow-green (hue 170° → 68°), lighter tint border

Hue decreases with size: larger aggregate nodes (Module) are blue-green/teal; smaller leaf nodes (Endpoint) are yellow-green. All colors share ~40% lightness for consistent contrast on the dark canvas.

| ID | Node | Fill | Stroke | Diameter | Description |
|----|------|------|--------|----------|-------------|
| CL-0 | `Module` | `#3A8E6A` | `#88C8A8` | 26px | Mossy teal — largest codebase aggregate |
| CL-1 | `File` | `#5A9E4A` | `#98D888` | 22px | Green — source file |
| CL-2 | `Class` | `#4A9E5A` | `#88D898` | 20px | Vivid green — class definition |
| CL-3 | `Function` | `#8A9E2A` | `#C8E880` | 16px | Yellow-green — function definition |
| CL-4 | `Config` | `#9A9E1A` | `#D8E880` | 14px | Yellow-green — configuration |
| CL-5 | `Table` | `#8A9E0A` | `#C8E870` | 12px | Grassy yellow-green — database table |
| CL-6 | `Endpoint` | `#7A9E0A` | `#B8E870` | 10px | Deep yellow-green — HTTP endpoint (smallest) |

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

#### Knowledge Concept Layer — rose (hue 328° → 348°), lighter pink border

| ID | Node | Fill | Stroke | Description |
|----|------|------|--------|-------------|
| KI-1 | `Decision` | `#C44878` | `#E890B0` | Rose — resolved question |
| KI-2 | `Concept` | `#C04070` | `#E080A0` | Pink-rose — specialist abstraction |
| KI-3 | `Claim` | `#BC3868` | `#D87090` | Rose — concept assertion |

#### Infrastructure Layer — slate-blue (hue 200° → 210°), lighter blue-gray border

| ID | Node | Fill | Stroke | Description |
|----|------|------|--------|-------------|
| IN-1 | `Document` | `#5A7A8A` | `#98B0C8` | Slate — documentation file |
| IN-2 | `Service` | `#4A6A7A` | `#88A0B8` | Dark slate — container/service definition |
| IN-3 | `Pipeline` | `#3A5A6A` | `#788898` | Mid slate — CI/CD pipeline |
| IN-4 | `Schema` | `#2A4A5A` | `#687888` | Deep slate — schema definition |
| IN-5 | `Resource` | `#1A3A4A` | `#586878` | Darkest slate — IaC resource |

### Relationships

| Relationship | Hex | Width | Group |
|-------------|-----|-------|-------|
| `HAS_FEATURE`, `HAS_OPERATION`, `DEPENDS_ON` | `#555555` | 2px | Backbone |
| `CONTAINS`, `IMPORTS`, `EXPORTS`, `INHERITS`, `IMPLEMENTS` | `#3A9E6A` | 1px | Codebase |
| `CALLS`, `READS_FROM`, `WRITES_TO`, `CONFIGURES`, `TESTED_BY` | `#3A9E6A` | 1px | Codebase |
| `EXPOSES`, `TRANSFORMS`, `VALIDATES`, `SUBSCRIBES`, `PUBLISHES`, `MIDDLEWARE`, `RELATED`, `SIMILAR_TO` | `#3A9E6A` | 1px | Codebase |
| `DOCUMENTS`, `DEPLOYS`, `MIGRATES`, `TRIGGERS`, `DEFINES_SCHEMA`, `SERVES`, `PROVISIONS`, `ROUTES` | `#3A9E6A` | 1px | Codebase |
| `SEQUENCE`, `PERFORMED_BY`, `RESTRICTED_FOR`, `GOVERNS`, `USES_ENTITY` | `#4A7AAE` | 1px | Knowledge |
| `DECIDES`, `SUB_CONCEPT_OF`, `IMPLEMENTS`, `SUPPORTS`, `APPLIES_IN`, `HAS_RISK`, `MITIGATED_BY` | `#4A7AAE` | 1px | Knowledge |
| `IMPLEMENTED_BY` | `#9A6AC8` | 2px | Bridge |
| `CONSTRAINED_BY` | `#C87098` | 1px | Concept |
