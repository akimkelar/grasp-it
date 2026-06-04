# Task 30: Wire `Project` Singleton into `/grasp` Skill Phases

## Objective

Complete the skill integration deferred from Task 22. Wire `saveProjectMeta` and `loadProjectMeta` into `/grasp` SKILL.md so that Phase 0 reads `gitCommitHash` from the Neo4j `Project` singleton (falling back to `knowledge-graph.json`) and Phase 7 writes it after every analysis run.

## Background

Task 22 implemented `saveProjectMeta` / `loadProjectMeta` in `grasp-it-plugin/packages/core/src/persistence/index.ts` and tested them. The core functions are ready. What remains is updating the skill's shell/script steps so the canonical commit hash lives in Neo4j rather than only in local files.

See `docs/graph/outdating-rules.md` → "Canonical source of `gitCommitHash`" and `docs/graph/architecture.md` → "Project Node".

## Implementation Checklist

### 1. Phase 0 — read `gitCommitHash` from Neo4j

- [ ] Open `grasp-it-plugin/skills/grasp/SKILL.md`
- [ ] In Phase 0 step 6 (currently: "read `.grasp-it/meta.json`"):
  1. Attempt to query the Neo4j `Project` singleton:
     ```cypher
     MATCH (p:Project {id: "project:singleton"})
     RETURN p.gitCommitHash, p.lastAnalyzedAt
     ```
  2. If the node exists and returns a hash → use it as `lastCommitHash`
  3. If the node does not exist or Neo4j is unavailable → fall back to `knowledge-graph.json` → `project.gitCommitHash`
  4. If neither exists → treat as first run (full analysis)

### 2. Phase 7 — write `gitCommitHash` to Neo4j

- [ ] In Phase 7 step 3 (currently: "write `meta.json`"):
  - After writing `meta.json` (keep this for backward compatibility), also call `saveProjectMeta` to persist `gitCommitHash`, `lastAnalyzedAt`, `version`, and `analyzedFiles` to the Neo4j `Project` singleton

### 3. Neo4j constraint on first run

- [ ] Ensure the uniqueness constraint for `Project.id` is created if it doesn't exist before the first `MERGE`:
  ```cypher
  CREATE CONSTRAINT project_id IF NOT EXISTS
  FOR (p:Project) REQUIRE p.id IS UNIQUE
  ```
  This may already be handled by `setup-neo4j-schema.cypher` (added in Task 22) — verify and skip if already applied.

### 4. Graceful degradation

- [ ] If Neo4j is not configured (no `NEO4J_URI` env var), skip the Neo4j read/write silently and rely on the local fallback
- [ ] The skill should work identically in offline/single-user mode as it did before this change

### 5. Tests

- [ ] Update or add a skill-level test (in `tests/skill/grasp/`) that mocks the Neo4j response and verifies Phase 0 uses the Neo4j hash when available
- [ ] Verify the fallback path (no Neo4j) uses `knowledge-graph.json`
- [ ] Run `pnpm test`

## Key Files

- `grasp-it-plugin/skills/grasp/SKILL.md` — Phase 0 (staleness check) and Phase 7 (save)
- `grasp-it-plugin/packages/core/src/persistence/index.ts` — `saveProjectMeta`, `loadProjectMeta` (already implemented)
- `grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher` — constraint (verify it's there)
- `docs/graph/outdating-rules.md`
- `docs/architecture/neo4j-schema.md`

## Completion

- [ ] All tests pass: `pnpm test`
- [ ] Lint clean: `pnpm lint`
- [ ] Create completion report at `docs/tasks/archive/30-report.md`
- [ ] Move this file to `docs/tasks/archive/30-wire-project-singleton-into-grasp-skill.md`
- [ ] Commit: `git add -A && git commit -m "feat: wire Project singleton read/write into /grasp Phase 0 and Phase 7"`
- [ ] Push: `git push`
