# Task 20 Report: Local-Only Data Storage Investigation

## Executive Summary

The grasp-it system stores knowledge graph data in two locations: local JSON files (`.grasp-it/`) and a cloud-hosted Neo4j database. This investigation identified **all local files** and classified their **multi-user sensitivity**. The critical finding is that `fingerprints.json` and `meta.json` are **local-only optimizations** that could cause issues in multi-user scenarios but are **not structurally required** — the graph data itself lives in Neo4j.

---

## Part 1: Data Inventory

### Local Files in `.grasp-it/`

| File | Produced By | Consumed By | Data Contents | Neo4j Equivalent | Sensitivity |
|------|-------------|------------|---------------|------------------|-------------|
| `knowledge-graph.json` | `/grasp` (Phase 7), `/grasp-knowledge` | `/grasp-diff`, `/grasp-explain`, `/grasp-domain`, dashboard | Full graph: nodes, edges, layers, tour | **Yes** — same data written to Neo4j via persistence layer | Critical |
| `domain-graph.json` | `/grasp-domain` (Phase 5) | Dashboard | Domain/Feature/Operation/Actor/BusinessRule/Entity nodes | Yes — these node types ARE in Neo4j schema | Important |
| `fingerprints.json` | `build-fingerprints.mjs` (Phase 7 step 2.5) | `change-classifier.ts`, `analyzeChanges()` | Per-file structural fingerprints: function signatures, class methods, import/export lists, content hashes | **No** — purely local optimization for auto-update | Low (for single user) |
| `meta.json` | `/grasp` (Phase 7 step 3) | `staleness.ts`, `/grasp` (incremental check) | lastAnalyzedAt, gitCommitHash, version, analyzedFiles | **Partial** — gitCommitHash could be stored in Neo4j project metadata | Important |
| `config.json` | `/grasp` (Phase 0.5) | `/grasp` | { autoUpdate: boolean, outputLanguage: string } | **No** — purely local user preference | Low |
| `.graspignore` | `/grasp` (Phase 0.5) or user | `scan-project.mjs`, `createIgnoreFilter()` | gitignore-style patterns for file exclusion | No — purely local ignore configuration | Low |
| `diff-overlay.json` | `/grasp-diff` | Dashboard | changedFiles, changedNodeIds, affectedNodeIds | No — derived from existing graph + diff | Low |
| `graph-updates/*.cypher` | `/grasp-gaps` | User/admin for applying to Neo4j | Dated incremental Cypher refresh artifacts | Yes — these ARE meant for Neo4j | Important (applied externally) |
| `intermediate/` (dir) | `/grasp`, `/grasp-domain`, `/grasp-knowledge` | Merge scripts, subagents | scan-result.json, batches.json, batch-*.json, assembled-graph.json, domain-context.json, domain-analysis.json | No — temporary processing artifacts | Low (cleaned after Phase 7) |
| `tmp/` (dir) | `/grasp` | `/grasp` | changed-files.txt, ua-inline-validate.cjs | No — temporary processing artifacts | Low (cleaned after Phase 7) |

---

### Intermediate Files (temporary, cleaned after analysis)

| File | Location | Produced By | Consumed By |
|------|----------|-------------|-------------|
| `scan-result.json` | `.grasp-it/intermediate/` | project-scanner agent | compute-batches.mjs |
| `batches.json` | `.grasp-it/intermediate/` | compute-batches.mjs | file-analyzer subagents |
| `batch-*.json` | `.grasp-it/intermediate/` | file-analyzer subagents | merge-batch-graphs.py |
| `assembled-graph.json` | `.grasp-it/intermediate/` | merge-batch-graphs.py | assemble-reviewer agent, Phase 6 |
| `layers.json` | `.grasp-it/intermediate/` | architecture-analyzer agent | Phase 5 |
| `tour.json` | `.grasp-it/intermediate/` | tour-builder agent | Phase 5 |
| `review.json` | `.grasp-it/intermediate/` | graph-reviewer or inline validator | Phase 6 |
| `domain-context.json` | `.grasp-it/intermediate/` | extract-domain-context.py | domain-analyzer agent |
| `domain-analysis.json` | `.grasp-it/intermediate/` | domain-analyzer agent | Phase 5 |
| `scan-manifest.json` | `.grasp-it/intermediate/` | parse-knowledge-base.py (grasp-knowledge) | article-analyzer agents |
| `analysis-batch-*.json` | `.grasp-it/intermediate/` | article-analyzer agents | merge-knowledge-graph.py |
| `assembled-graph.json` | `.grasp-it/intermediate/` | merge-knowledge-graph.py | Phase 5 (grasp-knowledge) |

---

## Part 2: Detailed Analysis by File

### 2.1 `knowledge-graph.json`

**Path:** `$PROJECT_ROOT/.grasp-it/knowledge-graph.json`

**Produced by:**
- `/grasp` skill Phase 7 step 1 (full or incremental graph write)
- `/grasp-knowledge` skill Phase 5

**Consumed by:**
- `/grasp-diff` — reads to map changed files to nodes
- `/grasp-explain` — reads to find component context
- `/grasp-domain` — reads to derive domain graph (Phase 3)
- Dashboard — visualizes the graph

**Data Contents:**
```json
{
  "version": "1.0.0",
  "project": { "name", "languages", "frameworks", "description", "analyzedAt", "gitCommitHash" },
  "nodes": [ GraphNode ],
  "edges": [ GraphEdge ],
  "layers": [ Layer ],
  "tour": [ TourStep ]
}
```

**Neo4j Equivalent:** Yes. The persistence layer (`grasp-it-plugin/packages/core/src/persistence/index.ts`) writes the same graph data to Neo4j. The local JSON is a cache/dashboard artifact.

**Sensitivity:** **Critical** — Graph integrity depends on this being accurate. However, since the same data lives in Neo4j, multi-user conflicts resolve via Neo4j's transactional model.

---

### 2.2 `domain-graph.json`

**Path:** `$PROJECT_ROOT/.grasp-it/domain-graph.json`

**Produced by:** `/grasp-domain` skill Phase 5

**Consumed by:** Dashboard (domain view)

**Data Contents:** Domain knowledge nodes (Domain, Feature, Operation, Actor, BusinessRule, Entity) with relationships (HAS_FEATURE, HAS_OPERATION, PERFORMED_BY, GOVERNS, etc.)

**Neo4j Equivalent:** Yes — these node types are in the Neo4j schema and can be queried from the database.

**Sensitivity:** **Important** — Dashboard visualization depends on this. Can be regenerated from Neo4j if needed.

---

### 2.3 `fingerprints.json`

**Path:** `$PROJECT_ROOT/.grasp-it/fingerprints.json`

**Produced by:** `build-fingerprints.mjs` (invoked in `/grasp` Phase 7 step 2)

**Consumed by:**
- `change-classifier.ts` — `classifyUpdate()` uses `analyzeChanges()` to determine update strategy
- `staleness.ts` — not directly, but drives the incremental update logic

**Data Contents:**
```typescript
interface FingerprintStore {
  version: "1.0.0";
  gitCommitHash: string;
  generatedAt: string;
  files: Record<string, FileFingerprint>; // keyed by relative path
}

interface FileFingerprint {
  filePath: string;
  contentHash: string;       // SHA-256 of file content
  functions: FunctionFingerprint[];   // name, params, returnType, exported, lineCount
  classes: ClassFingerprint[];       // name, methods, properties, exported, lineCount
  imports: ImportFingerprint[];      // source, specifiers
  exports: string[];
  totalLines: number;
  hasStructuralAnalysis: boolean;
}
```

**Neo4j Equivalent:** **No** — purely local optimization for incremental updates. Neo4j does not store structural fingerprints.

**Sensitivity:** **Low for single user** — purely an optimization to avoid re-analyzing unchanged files. If missing/empty, the system falls back to full analysis or conservative STRUCTURAL classification.

**Multi-user issue:** If User A runs `/grasp` and User B simultaneously tries an incremental update, User B's fingerprint comparison may use stale fingerprints from before User A's analysis completed.

---

### 2.4 `meta.json`

**Path:** `$PROJECT_ROOT/.grasp-it/meta.json`

**Produced by:** `/grasp` skill Phase 7 step 3 (written only after fingerprints.json succeeds)

**Consumed by:**
- `staleness.ts` — `isStale()` compares current HEAD to stored `gitCommitHash`
- `/grasp` Phase 0 — decision logic for full vs incremental update

**Data Contents:**
```json
{
  "lastAnalyzedAt": "2026-06-04T12:00:00.000Z",
  "gitCommitHash": "abc123...",
  "version": "1.0.0",
  "analyzedFiles": 247
}
```

**Neo4j Equivalent:** **Partial** — `gitCommitHash` and `lastAnalyzedAt` are project-level metadata. Neo4j constraint indexes could store this, but currently does not.

**Sensitivity:** **Important** — Incorrect `gitCommitHash` causes the staleness check to either:
- False positive: thinks graph is stale when it isn't (triggers unnecessary re-analysis)
- False negative: thinks graph is current when it isn't (misses changes)

**Multi-user issue:** Same as fingerprints — concurrent analysis can create race conditions in staleness detection.

---

### 2.5 `config.json`

**Path:** `$PROJECT_ROOT/.grasp-it/config.json`

**Produced by:** `/grasp` skill Phase 0.5 (language preference) and Phase 0.5 (auto-update flag)

**Consumed by:** `/grasp` skill

**Data Contents:**
```json
{
  "autoUpdate": false,
  "outputLanguage": "en"
}
```

**Neo4j Equivalent:** **No** — purely local user preference. Does not affect graph correctness.

**Sensitivity:** **Low** — purely cosmetic. Can be re-set by user at any time.

---

### 2.6 `.graspignore`

**Path:** `$PROJECT_ROOT/.grasp-it/.graspignore`

**Produced by:** `/grasp` Phase 0.5 (auto-generated starter) or user manual edit

**Consumed by:**
- `scan-project.mjs` via `createIgnoreFilter()`
- `ignore-filter.ts` via `createIgnoreFilter()`

**Data Contents:** gitignore-style patterns (e.g., `node_modules/`, `dist/`, `*.min.js`)

**Neo4j Equivalent:** **No** — purely local file filtering configuration.

**Sensitivity:** **Low** — affects which files are analyzed but doesn't affect graph structure.

---

### 2.7 `diff-overlay.json`

**Path:** `$PROJECT_ROOT/.grasp-it/diff-overlay.json`

**Produced by:** `/grasp-diff` skill step 7

**Consumed by:** Dashboard (for diff visualization)

**Data Contents:**
```json
{
  "version": "1.0.0",
  "baseBranch": "main",
  "generatedAt": "2026-06-04T12:00:00.000Z",
  "changedFiles": ["src/auth.ts", "src/utils.ts"],
  "changedNodeIds": ["function:src/auth.ts:login", "function:src/auth.ts:logout"],
  "affectedNodeIds": ["function:src/auth.ts:validate", "class:src/auth.ts:AuthService"]
}
```

**Neo4j Equivalent:** **No** — derived from existing graph + git diff. Can be regenerated.

**Sensitivity:** **Low** — purely a visualization artifact.

---

### 2.8 `graph-updates/` Directory

**Path:** `$PROJECT_ROOT/.grasp-it/graph-updates/`

**Produced by:** `/grasp-gaps` skill Phase 5

**Consumed by:** User/admin (applies to Neo4j externally)

**Data Contents:** Dated `.cypher` files (e.g., `2026-05-12-notification-settings-refresh.cypher`)

**Neo4j Equivalent:** **Yes** — these files are specifically designed to be applied to Neo4j.

**Sensitivity:** **Important** — Contains user's manual graph enrichment. Should be preserved alongside Neo4j.

---

## Part 3: Multi-User Scenario Analysis

### Scenario: User A runs `/grasp`, User B runs `/grasp-diff` simultaneously

**Race Condition Analysis:**

| File | Conflict | Impact |
|------|----------|--------|
| `knowledge-graph.json` | Both write | Last-write-wins; possible corruption if writes interleave | 
| `meta.json` | User A writes last | User B may get incorrect staleness result |
| `fingerprints.json` | User A writes last | User B's incremental analysis may miss/re-misclassify changes |
| `intermediate/` | Both write | Merge script may read partial files |
| `tmp/` | Both write | Temp files may conflict |

**What Breaks:**
1. User B's `/grasp-diff` may read a partially-written `knowledge-graph.json` (corrupt JSON)
2. User B's staleness check uses `meta.json` written by User A's in-progress analysis — incorrect commit hash comparison
3. User B's incremental update decision (`classifyUpdate()`) uses stale fingerprints — incorrect change classification

**Current Mitigation:** None. The system assumes single-user exclusive access.

**Recommended Handling:**
- Add file locking (flock or similar) around read-modify-write cycles for `meta.json` and `fingerprints.json`
- Or: migrate `meta.json` and `fingerprints.json` to Neo4j (see recommendations)

---

### Scenario: User A runs `/grasp --full`, User B runs `/grasp --full` simultaneously

**Impact:** Both run full analysis and overwrite each other's results. The second to complete wins. No data loss (both complete successfully), but one analysis result is lost.

**What Breaks:**
- Dashboard may show graph from User A, then User B's (last write wins)
- Either user's dashboard session sees inconsistent results

---

### Scenario: User A runs `/grasp-domain`, User B runs `/grasp-domain` simultaneously

**Impact:** Both write to `domain-graph.json`. Last-write-wins.

**What Breaks:** Minor — domain graph is regenerated from codebase or existing `knowledge-graph.json`. No lasting corruption.

---

## Part 4: Neo4j Schema Cross-Reference

### What IS in Neo4j (from `docs/architecture/neo4j-schema.md`)

**Codebase Nodes:** File, Function, Class, Module, Config, Table, Endpoint, Document, Service, Pipeline, Schema, Resource

**Knowledge Nodes:** Domain, Feature, Operation, Actor, BusinessRule, Entity, Decision, Constraint, Article, Topic, Claim, Source

**Relationships:** CONTAINS, IMPORTS, EXPORTS, INHERITS, IMPLEMENTS, CALLS, READS_FROM, WRITES_TO, CONFIGUREs, TESTED_BY, DEPENDS_ON, HAS_FEATURE, HAS_OPERATION, SEQUENCE, PERFORMED_BY, RESTRICTED_FOR, GOVERNS, USES_ENTITY, IMPLEMENTED_BY, DECIDES, CONSTRAINED_BY, etc.

### What is NOT in Neo4j (local-only)

| Data | Why Not in Neo4j | Can It Migrate? |
|------|------------------|------------------|
| `fingerprints.json` | Performance optimization for incremental updates | Could migrate (see below) |
| `meta.json` (gitCommitHash) | Simple local tracking | Yes — add project metadata to Neo4j |
| `config.json` | User preference | Could migrate (per-user config) |
| `.graspignore` | File filtering, not graph data | N/A — not needed in Neo4j |
| `diff-overlay.json` | Derived visualization data | N/A — regenerated on demand |

---

## Part 5: Gap Analysis — What Is NOT in Neo4j But Should Be

### Gap 1: Project Metadata in Neo4j

**Current state:** `gitCommitHash` and `lastAnalyzedAt` are stored only in `meta.json`.

**Recommendation:** Add a `Project` node or `AnalysisMeta` properties to Neo4j:
```cypher
// Project metadata node
MERGE (p:Project {id: $projectId})
SET p.lastAnalyzedAt = $timestamp,
    p.gitCommitHash = $commitHash,
    p.analyzedFiles = $count
```

This would eliminate the need for `meta.json` for staleness checking.

---

### Gap 2: Fingerprint Store in Neo4j (for Multi-User)

**Current state:** `fingerprints.json` is local-only. Each user has their own fingerprint baseline.

**Multi-user problem:** User A's incremental update uses fingerprints from before User B's analysis.

**Recommendation:** Store fingerprints in Neo4j with user scoping OR accept that fingerprints are inherently per-analysis-session and rebuild them on each `/grasp` run (performance cost).

**Alternative:** Store `fingerprints.json` in a shared location (but this doesn't solve the fundamental race condition — fingerprints are based on a specific commit, and commits can change during analysis).

---

### Gap 3: No Concurrent-Write Protection

**Current state:** Multiple `/grasp` runs can write to the same local files and Neo4j simultaneously.

**Recommendation:** 
1. Add Neo4j write transactions with optimistic locking
2. Add file locking for local JSON files
3. Or: accept last-write-wins and document this limitation

---

## Part 6: Recommendations

### 6.1 Must Be Cloud-Stored (Multi-User Critical)

| Data | Recommendation | Rationale |
|------|----------------|------------|
| `knowledge-graph.json` (via Neo4j) | Already in Neo4j — no action needed | Graph integrity |
| `domain-graph.json` (via Neo4j) | Already in Neo4j — no action needed | Domain knowledge persistence |
| `meta.json` (gitCommitHash) | **Migrate to Neo4j** — add `Project` metadata node | Enables correct staleness checking across users |

### 6.2 Can Be Local (Cache or Transient)

| Data | Recommendation | Rationale |
|------|----------------|------------|
| `fingerprints.json` | Keep as local cache (accept limitation) OR rebuild on every `/grasp` | Performance optimization; acceptable for single-user or accept full rebuild |
| `config.json` | Keep as local | User preference; not graph-critical |
| `.graspignore` | Keep as local | File filtering; not graph-critical |
| `diff-overlay.json` | Keep as local or regenerate on demand | Visualization artifact |
| `intermediate/` | Keep as local (cleaned after Phase 7) | Temporary processing |
| `tmp/` | Keep as local (cleaned after Phase 7) | Temporary processing |
| `graph-updates/` | Keep as local artifact (user-managed) | External Cypher files for manual Neo4j updates |

### 6.3 Architectural Changes Needed

1. **Add Project Metadata to Neo4j** — Store `gitCommitHash` and `lastAnalyzedAt` in Neo4j so staleness checking works across users.

2. **Add File Locking** — For local JSON files (`meta.json`, `fingerprints.json`), add file locking around read-modify-write cycles.

3. **Document Multi-User Limitations** — If keeping fingerprints local, document that simultaneous `/grasp` runs may cause incorrect incremental update decisions.

4. **Consider Fingerprint Rebuild** — If multi-user correctness is critical, consider rebuilding fingerprints on every `/grasp` run instead of relying on cached local fingerprints.

---

## Part 7: Summary Table

| File | Producer | Consumer | Cloud-Stored? | Sensitivity | Recommendation |
|------|----------|----------|---------------|-------------|----------------|
| `knowledge-graph.json` | /grasp, /grasp-knowledge | /grasp-diff, /grasp-explain, /grasp-domain, dashboard | **Yes** (Neo4j) | Critical | Already cloud-stored |
| `domain-graph.json` | /grasp-domain | dashboard | **Yes** (Neo4j) | Important | Already cloud-stored |
| `fingerprints.json` | build-fingerprints.mjs | change-classifier.ts | **No** | Low (single-user) | Keep local; document multi-user limitation |
| `meta.json` | /grasp | staleness.ts | **No** (only gitCommitHash) | Important | **Migrate gitCommitHash to Neo4j** |
| `config.json` | /grasp | /grasp | No | Low | Keep local |
| `.graspignore` | /grasp (auto-gen) or user | scan-project.mjs | No | Low | Keep local |
| `diff-overlay.json` | /grasp-diff | dashboard | No | Low | Keep local or regenerate |
| `graph-updates/*.cypher` | /grasp-gaps | user (external to Neo4j) | Yes (intended for Neo4j) | Important | Keep as user-managed artifact |
| `intermediate/` | analysis phases | merge scripts | No | Low | Keep local; cleaned after Phase 7 |
| `tmp/` | analysis phases | analysis phases | No | Low | Keep local; cleaned after Phase 7 |

---

## Appendix: File Origins

### Core Package Files Referenced
- `/grasp-it-plugin/packages/core/src/persistence/index.ts` — All local file I/O (7 functions: saveGraph, loadGraph, saveMeta, loadMeta, saveFingerprints, loadFingerprints, saveConfig, loadConfig, saveDomainGraph, loadDomainGraph)
- `/grasp-it-plugin/packages/core/src/fingerprint.ts` — Fingerprint building and comparison logic
- `/grasp-it-plugin/packages/core/src/staleness.ts` — Git-based staleness checking
- `/grasp-it-plugin/packages/core/src/change-classifier.ts` — Update classification based on fingerprints

### Skill Files Referenced
- `/grasp-it-plugin/skills/grasp/SKILL.md` — Main /grasp skill (Phase 0-7)
- `/grasp-it-plugin/skills/grasp/build-fingerprints.mjs` — Fingerprint baseline builder
- `/grasp-it-plugin/skills/grasp/scan-project.mjs` — File enumeration with ignore filtering
- `/grasp-it-plugin/skills/grasp/merge-batch-graphs.py` — Batch merge and normalization
- `/grasp-it-plugin/skills/grasp-diff/SKILL.md` — Diff analysis skill
- `/grasp-it-plugin/skills/grasp-domain/SKILL.md` — Domain extraction skill
- `/grasp-it-plugin/skills/grasp-domain/extract-domain-context.py` — Domain context extraction
- `/grasp-it-plugin/skills/grasp-knowledge/SKILL.md` — Knowledge base analysis
- `/grasp-it-plugin/skills/grasp-knowledge/merge-knowledge-graph.py` — Knowledge graph merge
- `/grasp-it-plugin/skills/grasp-gaps/SKILL.md` — Graph gap filling
- `/grasp-it-plugin/skills/grasp-search/SKILL.md` — Neo4j query skill
