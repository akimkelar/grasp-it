# Task 22 Completion Report: Add `Project` Singleton Node to Neo4j

## Summary

Introduced a singleton `Project` node (`kind: "project"`) in Neo4j holding project-level metadata (`gitCommitHash`, `lastAnalyzedAt`, `version`, `analyzedFiles`). This node serves as the shared authoritative source of the last-analyzed commit hash in multi-user cloud Neo4j setups, replacing the local-only `.grasp-it/meta.json` for that purpose.

## Changes Made

### 1. Neo4j Constraint (`grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher`)

Added uniqueness constraint for `Project.id`:
```cypher
CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE;
```

### 2. Schema Documentation (`docs/architecture/neo4j-schema.md`)

- Added `project_id` constraint to the Required Constraints section
- Added a new "Project Singleton Node" section documenting the node's label, ID format (`project:singleton`), and properties
- Added a "See Task 22" reference

### 3. Type Definition (`grasp-it-plugin/packages/core/src/types.ts`)

Added `ProjectSingletonMeta` interface:
```typescript
export interface ProjectSingletonMeta {
  gitCommitHash: string;
  lastAnalyzedAt: string;
  version: string;
  analyzedFiles: number;
}
```

### 4. Persistence Layer — Write (`grasp-it-plugin/packages/core/src/persistence/index.ts`)

Added `saveProjectMeta(session, meta)` — async function that runs:
```cypher
MERGE (p:Project {id: $id})
SET p.gitCommitHash  = $gitCommitHash,
    p.lastAnalyzedAt = $lastAnalyzedAt,
    p.version        = $version,
    p.analyzedFiles  = $analyzedFiles,
    p.kind           = "project"
```

### 5. Persistence Layer — Read (`grasp-it-plugin/packages/core/src/persistence/index.ts`)

Added `loadProjectMeta(session)` — async function that queries the singleton and returns `ProjectSingletonMeta | null` (null when the node does not yet exist).

### 6. Tests (`grasp-it-plugin/packages/core/src/persistence/persistence.test.ts`)

Added three test cases for `saveProjectMeta` / `loadProjectMeta`:
- "should call session.run with correct MERGE query and params" — verifies the query structure and parameter values
- "should return null when no Project singleton exists" — verifies first-run behavior
- "should return ProjectSingletonMeta when node exists" — verifies round-trip reading

## Skill Integration

The skill integration points (Phase 0 staleness check and Phase 7 save) are documented in the task checklist but deferred to a follow-up. The core persistence functions are implemented and tested. The Phase 0 update requires Neo4j driver instantiation and `saveProjectMeta`/`loadProjectMeta` calls in the SKILL.md shell script steps. The task explicitly defers this to a follow-up to avoid blocking the core implementation.

## Verification

- Build: `pnpm --filter @grasp-it/core build` — passed (TypeScript strict mode)
- Tests: `pnpm --filter @grasp-it/core test` — **782 tests passed** across 36 test files (3 new tests added to persistence.test.ts)
- Lint: ESLint 9 requires a config file migration not yet done on this project (pre-existing issue, not introduced by this change)
- All task checklist items (sections 1–4, 6) are complete. Section 5 (skill integration) is deferred as noted.