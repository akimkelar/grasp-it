# Neo4j-First Design

## Problem Statement

The current implementation uses `knowledge-graph.json`, `meta.json`, and `domain-graph.json` as primary data sources, with Neo4j as secondary. This causes:

1. **Staleness checks read JSON files first** — should query Neo4j `Project` singleton
2. **Domain graph is local-only** — not persisted to Neo4j, making it unqueryable
3. **Incremental updates require JSON files** — `mergeGraphUpdate()` reads `knowledge-graph.json`
4. **Skills depend on JSON files** — `/grasp-domain`, `/grasp-diff`, `/grasp-search`, `/grasp-interview` all read JSON files directly
5. **No single source of truth** — data lives in two places, easily diverges

## Design Principles

1. **Neo4j is the ONLY source of truth** — no JSON fallback, no local intermediate state
2. **All reads go directly to Neo4j** — query the graph, never a file
3. **All writes go directly to Neo4j** — persist to the graph, never to a file
4. **Staleness from Neo4j** — `Project` singleton's `gitCommitHash` determines if analysis is fresh
5. **Domain graph in Neo4j** — domain nodes stored in Neo4j, queryable immediately after write

## Architecture

### Data Flow

```
/grasp runs → writes directly to Neo4j (no JSON)
/grasp-domain reads from Neo4j → produces domain graph → writes directly to Neo4j
other skills → read directly from Neo4j → no JSON file dependency whatsoever
```

### Project Singleton

Every project has a single `Project` node:

```cypher
MERGE (p:Project {id: $projectId})
SET p.gitCommitHash = $commitHash,
    p.lastAnalyzedAt = datetime(),
    p.version = $version,
    p.analyzedFiles = $analyzedFiles,
    p.kind = "project"
```

Staleness check: compare `gitCommitHash` vs `git rev-parse HEAD`.

### Domain Graph Storage

Domain graph nodes stored with:
- Primary label: `Knowledge`
- Secondary label: `Domain`, `Feature`, `Operation`, `Actor`, `BusinessRule`, `Entity`
- Relationship to `Project`: `(:Knowledge)-[:PART_OF]->(:Project)`

Staleness: compare `Project.gitCommitHash` vs `Project.domainCommit` — if different, domain graph is stale.

### File Elimination

| File | Status | Action |
|------|--------|--------|
| `knowledge-graph.json` | **Eliminated** | Remove all reads/writes |
| `meta.json` | **Eliminated** | Remove all reads/writes |
| `domain-graph.json` | **Eliminated** | Remove all reads/writes |

**Note:** `persistence/index.ts` should be updated to remove `loadGraph`, `saveGraph`, `loadMeta`, `saveMeta`, `loadDomainGraph`, `saveDomainGraph` functions that read/write JSON files. Replace with Neo4j-only equivalents.

### No Graceful Degradation

This is a Neo4j-dependent system. If Neo4j is unavailable:
- **Reads fail** — skill exits with error indicating no graph available
- **Writes fail** — skill exits with error indicating write failure
- **No fallback to JSON** — the JSON files are simply not used

This is intentional. The system is designed for teams using Neo4j as their knowledge graph backend. If Neo4j is not available, the skills cannot function.

## Implementation Changes

### 1. `staleness.ts` — Neo4j-Only

```typescript
async function checkGraphFreshness(projectId: string, projectRoot: string, session: Session): Promise<StalenessResult> {
  // Query Neo4j Project singleton
  const result = await session.run(`
    MATCH (p:Project {id: $projectId})
    RETURN p.gitCommitHash AS gitCommitHash
 `, { projectId });

  if (result.records.length === 0) {
    throw new Error(`No analysis found for project ${projectId}. Run /grasp first.`);
  }

  const neo4jMeta = result.records[0].get('gitCommitHash');
  const head = await gitHead(projectRoot);

  return {
    stale: neo4jMeta !== head,
    lastCommit: neo4jMeta,
    headCommit: head,
    commitsBehind: await gitCommitDistance(neo4jMeta, head, projectRoot),
  };
}
```

###2. Domain Graph in Neo4j

Domain graph nodes (domain, feature, operation, actor, business-rule, entity) stored with:
- Primary label: `Knowledge`
- Secondary label: `Domain`, `Feature`, `Operation`, `Actor`, `BusinessRule`, `Entity`
- Relationship to `Project`: `(:Knowledge)-[:PART_OF]->(:Project)`

```typescript
async function saveDomainGraphToNeo4j(session: Session, domainGraph: DomainGraph, projectId: string) {
  // Clear existing domain elements for this project
  await session.run(`
    MATCH (d:Knowledge)-[:PART_OF]->(p:Project {id: $projectId})
    DELETE d
  `, { projectId });

  // Write new domain elements
  for (const node of domainGraph.nodes) {
    await session.run(`
      MATCH (p:Project {id: $projectId})
      CREATE (d:Knowledge:${node.label} {
        id: $id,
        name: $name,
        source: $source,
        sourceFile: $sourceFile
      })
      CREATE (d)-[:PART_OF]->(p)
    `, { projectId, id: node.id, name: node.name, source: node.source, sourceFile: node.sourceFile });
  }

  // Update Project with domain analysis metadata
  await session.run(`
    MATCH (p:Project {id: $projectId})
    SET p.domainAnalyzedAt = datetime(),
        p.domainCommit = $commit
  `, { projectId, commit: domainGraph.project.gitCommitHash });
}
```

### 3. Remove JSON File Reads from Skills

| Skill | Current Behavior | New Behavior |
|-------|-----------------|--------------|
| `/grasp-domain` | Reads `knowledge-graph.json` for derivation | Query Neo4j for knowledge graph nodes |
| `/grasp-diff` | Reads `gitCommitHash` from JSON | Query `Project.gitCommitHash` from Neo4j |
| `/grasp-search` | Reads `gitCommitHash` from JSON | Query `Project.gitCommitHash` from Neo4j |
| `/grasp-interview` | Reads existing graph from JSON | Query Neo4j for existing nodes |
| `/grasp-chat` | Reads graph from JSON | Query Neo4j |
| `/grasp-explain` | Checks JSON existence | Query Neo4j for `Project` |

### 4. Remove `domainGraphStale` Flag

Replace `domainGraphStale: true/false` in `meta.json` with:
- `Project.domainCommit` — commit at which domain analysis was last run
- Staleness: `Project.gitCommitHash != Project.domainCommit` means domain graph is stale

### 5. Remove Files from persistence/index.ts

Remove or deprecate:
- `loadGraph()` — reads from `knowledge-graph.json`
- `saveGraph()` — writes to `knowledge-graph.json`
- `loadMeta()` — reads from `meta.json`
- `saveMeta()` — writes to `meta.json`
- `loadDomainGraph()` — reads from `domain-graph.json`
- `saveDomainGraph()` — writes to `domain-graph.json`

Replace with Neo4j-only equivalents:
- `loadGraphFromNeo4j(session, projectId)` — query all nodes/edges for project
- `saveGraphToNeo4j(session, graph, projectId)` — persist full graph to Neo4j
- `loadProjectMetaFromNeo4j(session, projectId)` — query Project singleton
- `saveProjectMetaToNeo4j(session, projectMeta, projectId)` — persist Project singleton
- `loadDomainGraphFromNeo4j(session, projectId)` — query Knowledge nodes
- `saveDomainGraphToNeo4j(session, domainGraph, projectId)` — persist domain graph

## Key Files to Modify

1. `packages/core/src/staleness.ts` — Neo4j-only staleness (no JSON fallback)
2. `packages/core/src/persistence/index.ts` — Remove JSON file functions, add Neo4j-only equivalents
3. `skills/grasp-domain/SKILL.md` — Neo4j-only reads/writes
4. `skills/grasp/SKILL.md` — Remove JSON reads, Neo4j-only
5. `skills/grasp-diff/SKILL.md` — Neo4j reads
6. `skills/grasp-search/SKILL.md` — Neo4j reads
7. `skills/grasp-interview/SKILL.md` — Neo4j reads
8. `skills/grasp-chat/SKILL.md` — Neo4j reads
9. `skills/grasp-explain/SKILL.md` — Neo4j reads
10. `hooks/auto-update-prompt.md` — Neo4j reads/writes only
11. `hooks/hooks.json` — Remove JSON-based staleness checks

## Tests to Adapt

1. `tests/skill/staleness.test.ts` — Mock Neo4j only, remove JSON fallback tests
2. `tests/skill/domain-stale-flag.test.ts` — Replace with domain commit comparison test
3. `persistence.test.ts` — Remove JSON file tests, Neo4j-only tests
4. Any tests reading `knowledge-graph.json` or `meta.json` — remove entirely

## Build Requirements

After these changes:
- `pnpm --filter @grasp-it/core build` should succeed
- `pnpm test` should pass (all tests mocking Neo4j, no file I/O tests)
- Skills should function with only Neo4j as backend
