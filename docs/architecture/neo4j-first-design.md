# Neo4j-First Design

## Problem Statement

The current implementation uses `knowledge-graph.json`, `meta.json`, and `domain-graph.json` as primary data sources, with Neo4j as secondary. This causes:

1. **Staleness checks read JSON files first** — should query Neo4j `Project` singleton
2. **Domain graph is local-only** — not persisted to Neo4j, making it unqueryable
3. **Incremental updates require JSON files** — `mergeGraphUpdate()` reads `knowledge-graph.json`
4. **Skills depend on JSON files** — `/grasp-domain`, `/grasp-diff`, `/grasp-search`, `/grasp-requirements` all read JSON files directly
5. **No single source of truth** — data lives in two places, easily diverges

## Design Principles

1. **Neo4j is the source of truth** — all reads go to Neo4j first
2. **JSON files are write-through cache** — write to Neo4j, optionally persist JSON for portability/backup
3. **Graceful degradation** — if Neo4j unavailable, fall back to JSON files (not the other way around)
4. **Staleness from Neo4j** — `Project` singleton's `gitCommitHash` determines if analysis is fresh
5. **Domain graph in Neo4j** — domain nodes (domain, feature, operation, actor, business-rule, entity) stored in Neo4j

## Architecture

### Data Flow

```
/grasp runs → writes to Neo4j → optionally writes knowledge-graph.json (backup)
/grasp-domain reads from Neo4j → produces domain graph → writes to Neo4j
other skills → read from Neo4j → no JSON file dependency
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

Domain graph nodes use a separate label `DomainAnalysis` or are stored as part of the main graph with `kind: "domain-analysis"`. The `domainGraphStale` flag on `Project` is replaced by comparing `gitCommitHash` against the commit when domain analysis was last run.

### File Elimination

| File | Status | Reason |
|------|--------|--------|
| `knowledge-graph.json` | Deprecated as primary | Neo4j is source of truth |
| `meta.json` | Deprecated | `Project` singleton replaces it |
| `domain-graph.json` | Deprecated as primary | Domain graph in Neo4j |

### Graceful Degradation

If Neo4j is unavailable at read time:
1. Try Neo4j first
2. If connection fails, fall back to JSON files
3. Log warning that graph may be stale

If Neo4j is unavailable at write time:
1. Write to JSON files as fallback
2. Mark for sync when Neo4j becomes available

## Implementation Changes

### 1. `staleness.ts` — Query Neo4j First

Current: reads `knowledge-graph.json` → `meta.json` → git comparison
New: query `Project` singleton from Neo4j → compare `gitCommitHash` against HEAD

```typescript
async function checkGraphFreshness(projectId: string, projectRoot: string): Promise<StalenessResult> {
  // Try Neo4j first
  const neo4jMeta = await loadProjectMeta(projectId);
  if (neo4jMeta) {
    const head = await gitHead(projectRoot);
    return {
      stale: neo4jMeta.gitCommitHash !== head,
      lastCommit: neo4jMeta.gitCommitHash,
      headCommit: head,
      commitsBehind: await gitCommitDistance(neo4jMeta.gitCommitHash, head, projectRoot),
    };
  }
  // Fallback to JSON files
  return checkGraphFreshnessLegacy(projectRoot);
}
```

### 2. Domain Graph in Neo4j

Domain graph nodes (domain, feature, operation, actor, business-rule, entity) stored with:
- Primary label: `DomainElement`
- Secondary label: `Domain`, `Feature`, `Operation`, `Actor`, `BusinessRule`, `Entity`
- Relationship to `Project`: `(:DomainElement)-[:PART_OF]->(:Project)`

Staleness: compare `gitCommitHash` of `Project` vs when domain analysis ran (stored on `Project.domainAnalyzedAt` or `Project.domainCommit`).

### 3. Remove JSON File Reads from Skills

| Skill | Current Behavior | New Behavior |
|-------|-----------------|--------------|
| `/grasp-domain` | Reads `knowledge-graph.json` for derivation | Query Neo4j for domain nodes |
| `/grasp-diff` | Reads `gitCommitHash` from JSON | Query `Project.gitCommitHash` from Neo4j |
| `/grasp-search` | Reads `gitCommitHash` from JSON | Query `Project.gitCommitHash` from Neo4j |
| `/grasp-requirements` | Reads existing graph from JSON | Query Neo4j |
| `/grasp-chat` | Reads graph from JSON | Query Neo4j |
| `/grasp-explain` | Checks JSON existence | Query Neo4j for `Project` |

### 4. Persist Domain Graph to Neo4j

In `/grasp-domain` Phase 6b, instead of writing to `domain-graph.json`:

```typescript
async function saveDomainGraphToNeo4j(domainGraph: DomainGraph, projectId: string) {
  // Clear existing domain elements for this project
  await session.run(`
    MATCH (d:DomainElement)-[:PART_OF]->(p:Project {id: $projectId})
    DELETE d
  `, { projectId });

  // Write new domain elements
  for (const node of domainGraph.nodes) {
    await session.run(`
      MATCH (p:Project {id: $projectId})
      CREATE (d:DomainElement:${node.label} {
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

### 5. Remove `domainGraphStale` Flag

Replace `domainGraphStale: true/false` in `meta.json` with:
- `Project.domainCommit` — commit at which domain analysis was last run
- Staleness: `Project.gitCommitHash != Project.domainCommit` means domain graph is stale

## Key Files to Modify

1. `packages/core/src/staleness.ts` — Neo4j-first staleness
2. `packages/core/src/persistence/index.ts` — Neo4j-first reads/writes
3. `skills/grasp-domain/SKILL.md` — Query Neo4j, write domain graph to Neo4j
4. `skills/grasp/SKILL.md` — Remove JSON-first reads
5. `skills/grasp-diff/SKILL.md` — Neo4j reads
6. `skills/grasp-search/SKILL.md` — Neo4j reads
7. `skills/grasp-requirements/SKILL.md` — Neo4j reads
8. `skills/grasp-chat/SKILL.md` — Neo4j reads
9. `skills/grasp-explain/SKILL.md` — Neo4j reads
10. `hooks/auto-update-prompt.md` — Neo4j reads/writes
11. `hooks/hooks.json` — Remove JSON-based staleness checks

## Tests to Adapt

1. `tests/skill/staleness.test.ts` — Mock Neo4j instead of JSON files
2. `tests/skill/domain-stale-flag.test.ts` — Replace with domain commit comparison test
3. Any tests reading `knowledge-graph.json` or `meta.json` — adapt to Neo4j mocks
