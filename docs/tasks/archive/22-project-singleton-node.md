# Task 22: Add `Project` Singleton Node to Neo4j

## Objective

Introduce a singleton `Project` node (`kind: "project"`) in Neo4j that holds project-level metadata: `gitCommitHash`, `lastAnalyzedAt`, `version`, `analyzedFiles`. This node is the shared authoritative source of the last-analyzed commit hash in multi-user cloud Neo4j setups, replacing the local-only `.grasp-it/meta.json`.

## Background

See `docs/graph/outdating-rules.md` → "Design Decisions: Project singleton node" and `docs/graph/architecture.md` → "Project Node".

Currently, the last-analyzed commit hash lives only in `.grasp-it/meta.json` (local per-user) and `.grasp-it/knowledge-graph.json` (also local). In a multi-user Neo4j setup, there is no shared source of truth — two users can run `/grasp` concurrently against different commits without awareness of each other. The `Project` singleton solves this by writing metadata to Neo4j after every analysis.

The `Project` node survives codebase rebuilds because the wipe query is scoped to `WHERE n.kind = "codebase"`.

## Implementation Checklist

### 1. Neo4j constraint

- [ ] Add a uniqueness constraint for `Project.id` to `docs/architecture/neo4j-schema.md` and to any schema-init script:
  ```cypher
  CREATE CONSTRAINT project_id IF NOT EXISTS
  FOR (p:Project) REQUIRE p.id IS UNIQUE
  ```

### 2. Type definition

- [ ] Open `grasp-it-plugin/packages/core/src/types.ts`
- [ ] Add `ProjectSingletonMeta` (or extend `AnalysisMeta`) with the Neo4j-targeted fields
- [ ] Ensure `kind: "project"` is recognized as a valid `kind` value (currently only `"codebase"` and `"knowledge"` are used — add `"project"` without breaking existing `kind` checks)

### 3. Persistence layer — write

- [ ] Open `grasp-it-plugin/packages/core/src/persistence/index.ts`
- [ ] Add `saveProjectMeta(neo4jSession, meta: AnalysisMeta): Promise<void>` that runs:
  ```cypher
  MERGE (p:Project {id: "project:singleton"})
  SET p.gitCommitHash   = $gitCommitHash,
      p.lastAnalyzedAt  = $lastAnalyzedAt,
      p.version         = $version,
      p.analyzedFiles   = $analyzedFiles,
      p.kind            = "project"
  ```

### 4. Persistence layer — read

- [ ] Add `loadProjectMeta(neo4jSession): Promise<AnalysisMeta | null>` that queries the singleton
- [ ] Return `null` if the node does not exist yet (first run)

### 5. Skill integration

- [ ] Update `/grasp` SKILL.md Phase 7 (SAVE) to call `saveProjectMeta` after writing `knowledge-graph.json`
- [ ] Update `/grasp` SKILL.md Phase 0 staleness check to:
  1. Try `loadProjectMeta` from Neo4j
  2. Fall back to `knowledge-graph.json` → `project.gitCommitHash` if Neo4j unavailable
  3. Keep `.grasp-it/meta.json` write for backward compatibility (can be removed in a follow-up)

### 6. Tests

- [ ] Add integration test (or mock) that verifies `saveProjectMeta` writes and `loadProjectMeta` reads the correct hash
- [ ] Run `pnpm --filter @grasp-it/core test`

## Key Files

- `grasp-it-plugin/packages/core/src/types.ts`
- `grasp-it-plugin/packages/core/src/persistence/index.ts`
- `grasp-it-plugin/skills/grasp/SKILL.md`
- `docs/graph/architecture.md`
- `docs/graph/outdating-rules.md`
- `docs/architecture/neo4j-schema.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/22-report.md`
- [ ] Move this file to `docs/tasks/archive/22-project-singleton-node.md`
- [ ] Commit: `git add -A && git commit -m "feat: add Project singleton node to Neo4j for shared gitCommitHash"`
- [ ] Push: `git push`
