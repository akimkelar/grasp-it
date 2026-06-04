# Task 19 Report: Graph Outdating Rules Investigation

## Investigation Summary

Investigated how the codebase determines "outdated" nodes in the knowledge graph and updated `docs/graph/outdating-rules.md` accordingly.

## Key Findings

### 1. How "New" Code Is Determined

**Git commit hash comparison is the sole mechanism**, not file modification dates.

When `/grasp` runs, Phase 0 reads `meta.json` to get the previously stored `gitCommitHash`, then compares:

```bash
git diff <lastCommitHash>..HEAD --name-only
```

The git commit hash is stored in:
- `.grasp-it/meta.json` — `AnalysisMeta.gitCommitHash`
- `.grasp-it/fingerprints.json` — `FingerprintStore.gitCommitHash`
- `.grasp-it/knowledge-graph.json` — `project.gitCommitHash`

File modification timestamps are **not** used anywhere in staleness detection.

### 2. Git Commit Version Handling

The git commit hash IS stored in the graph (`project.gitCommitHash`) and is used to detect changes. Scripts check git history via `git diff <hash>..HEAD --name-only`. However:

- No script checks whether a specific file's content was different at an earlier commit (the diff is always between the stored hash and HEAD)
- `staleness.ts` (`isStale`, `mergeGraphUpdate`) is the core module handling this
- `fingerprint.ts` provides finer-grained change classification (`NONE`, `COSMETIC`, `STRUCTURAL`) but is only used by auto-update, not the main incremental path

### 3. Scripts Checking for Outdated Data

| Skill | Behavior |
|-------|----------|
| `/grasp` | Primary staleness checker. Reads `meta.json`, runs `git diff`, decides full vs. incremental |
| `/grasp-diff` | Reads existing graph and git diff to identify affected components. Does NOT write to graph or check staleness |
| `/grasp-domain` | Derives from existing graph; skips file scanning if graph exists (unless `--full`) |
| `/grasp-knowledge` | Separate wiki knowledge graph; has own file detection logic |

### 4. Update Scope

| Layer | Update Mechanism |
|-------|-----------------|
| **Codebase** (`kind: "codebase"`) | Full rebuild or incremental via `/grasp`. Changed-file nodes removed and re-created |
| **Domain** (`kind: "domain"`) | Stored in `domain-graph.json`. Not auto-updated when main graph changes |
| **Knowledge** (`kind: "knowledge"`) | Separate `/grasp-knowledge` run; manual staleness detection |

### 5. Gaps in Update Logic

1. **No cosmetic vs. structural distinction in main incremental path** — `git diff --name-only` treats all changes equally; the fingerprint system with `NONE/COSMETIC/STRUCTURAL` classification exists but is only used by auto-update, not the main incremental path

2. **Cross-file edge cleanup gaps** — when a file changes, only `filePath`-matched nodes and edges are removed. If imports change or functions are renamed within a changed file, dangling edges to other files may persist

3. **Domain graph not auto-updated** — `domain-graph.json` must be explicitly re-derived with `/grasp-domain` after codebase changes

4. **Knowledge nodes not auto-updated on code change** — `IMPLEMENTED_BY` edges from domain nodes to changed file nodes are not re-resolved during incremental updates

5. **Subdomain graph merge has no staleness check** — `merge-subdomain-graphs.py` does not verify that subdomain graphs are at the same git commit as the main graph

6. **No pre-flight staleness query** — `graph-reviewer` validates staleness but there is no automated check users can run before querying the graph

## Files Changed

### `docs/graph/outdating-rules.md`
Updated with accurate current behavior based on code investigation:

- Clarified that git commit hash comparison is the sole mechanism (not file modification dates)
- Added section on fingerprint-based change detection
- Added section on scripts that check for outdated data (all skills)
- Added update scope table
- Expanded gaps section with 6 specific edge cases
- Preserved existing Cypher queries for staleness detection
- Preserved existing resolution guidance

### `docs/tasks/archive/19-report.md`
This file — documents findings and changes made.

## Relevant Source Files

- `grasp-it-plugin/packages/core/src/staleness.ts` — core staleness detection (`isStale`, `mergeGraphUpdate`, `getChangedFiles`)
- `grasp-it-plugin/packages/core/src/fingerprint.ts` — fingerprint system (`ChangeLevel`, `analyzeChanges`)
- `grasp-it-plugin/packages/core/src/persistence/index.ts` — graph save/load (`saveGraph`, `loadGraph`)
- `grasp-it-plugin/packages/core/src/types.ts` — `ProjectMeta.gitCommitHash`, `AnalysisMeta.gitCommitHash`, `FingerprintStore`
- `grasp-it-plugin/skills/grasp/SKILL.md` — Phase 0 decision logic for incremental vs. full rebuild
- `grasp-it-plugin/skills/grasp/build-fingerprints.mjs` — fingerprint baseline builder
- `grasp-it-plugin/skills/grasp/merge-batch-graphs.py` — batch merge and normalization
- `grasp-it-plugin/skills/grasp-diff/SKILL.md` — diff analysis (does not check staleness or write graph)
- `grasp-it-plugin/skills/grasp-domain/SKILL.md` — domain graph derivation
- `grasp-it-plugin/skills/grasp-knowledge/SKILL.md` — wiki knowledge graph
