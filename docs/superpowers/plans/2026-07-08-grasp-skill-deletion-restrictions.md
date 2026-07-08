# Grasp Skill Deletion Restrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the MERGE-on-composite-label constraint violation bug and add hard policy guardrails to prevent destructive `DELETE` operations during `/grasp` runs, especially `--files`-scoped runs.

**Architecture:** Three tasks. Task 1 adds failing regression tests for the MERGE bug. Task 2 fixes the bug in `push-codebase-graph.mjs` (4 locations). Task 3 adds three policy guardrails to `SKILL.md`. No new files; only edits to existing files.

**Tech Stack:** Node.js (mjs scripts), Vitest, Neo4j Cypher, Markdown skill definitions.

## Global Constraints

- **Test runner:** Vitest (root `pnpm test`)
- **Node version:** >= 22 (developed on v24)
- **Style:** Match existing comment density, naming, and idiom in each file.
- **All commits must end with:** `Co-Authored-By: Claude <noreply@anthropic.com>`
- **No new files.** All changes are edits to existing files.
- **Frequent commits** — one commit per task.

## File Structure

| File | Role | Changes |
|---|---|---|
| `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs` | Push script (Bolt driver + cypher-shell paths) | Edit 4 MERGE patterns (Fix 2) |
| `tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs` | Integration tests for push script | Add 4 regression tests |
| `grasp-it-plugin/skills/grasp/SKILL.md` | Skill definition | Add scoped-run prohibition, Hard Rules section, Phase 6 destructive-ops subsection |

---

## Task 1: Add failing regression tests for the MERGE pattern

**Files:**
- Modify: `tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs` (append new `describe` block)

**Purpose:** Establish a test that fails today and passes after Task 2. The test invokes `push-codebase-graph.mjs` via a mock `cypher-shell` that echoes the Cypher query (read from stdin) to stderr. The assertions verify the generated MERGE uses bare `{id: ...}` and that `SET n:Codebase` and `SET n:\`<Label>\`` appear as separate clauses.

**Interfaces:**
- Consumes: existing test helpers `runPushCodebaseGraph(root, env)`, `writeGraph(nodes, edges, layers)` from the same file.
- Produces: 4 new test cases under a new `describe('REGRESSION: MERGE-on-bare-id pattern', ...)` block.

- [ ] **Step 1: Read the existing test file's structure**

Read `tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs` end-to-end so the new tests match its idiom. Pay attention to: how `writeGraph` accepts layers (or doesn't), how the mock cypher-shell is created, and how the `NEO4J_CONNECTION_TYPE=cypher-shell` environment variable forces the cypher-shell code path.

Also note that this file is ESM (`.mjs`). You will need to add `readFileSync` to the existing `import { ... } from "node:fs"` statement at the top of the file for the driver-path tests to read the push script source.

- [ ] **Step 2: Append the new describe block to the test file**

Open `tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs`. The file currently ends at line 269 with the closing `});` of the top-level describe. First, add `readFileSync` to the existing top-level import on line 15:

```javascript
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
```

Then append a new describe block AFTER the closing brace on line 269 (as a sibling, not a child).

```javascript

// ── REGRESSION: MERGE-on-bare-id prevents constraint violation on upgrade ─────
//
// Push script previously used `MERGE (n:Codebase {id: $id})`. When a pre-existing
// node with the same `id` lacked the `Codebase` label, the MERGE created a new
// node, then SET n:Class violated the unique index on Class.id. The fix merges
// on bare {id: $id} and sets labels separately. These tests verify both the
// cypher-shell path and the Bolt driver path use the bare-id pattern.

describe('REGRESSION: MERGE-on-bare-id prevents label-conflict constraint violation', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-merge-bare-'));
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  // Local writeGraph — accepts layers too. The outer describe's writeGraph
  // is closure-scoped and not visible from this sibling describe.
  function writeGraph(nodes = [], edges = [], layers = []) {
    writeFileSync(
      join(root, '.grasp-it', 'intermediate', 'assembled-graph.json'),
      JSON.stringify({
        project: { gitCommitHash: 'abc123' },
        version: '1.0.0',
        nodes,
        edges,
        layers,
      }),
    );
  }

  // Helper: create a mock cypher-shell that echoes stdin (the Cypher query) to
  // stderr so the test can inspect the generated query.
  function createEchoingCypherShell() {
    const mockDir = mkdtempSync(join(tmpdir(), 'mock-cypher-echo-'));
    writeFileSync(
      join(mockDir, 'cypher-shell'),
      `#!/bin/sh\ncat >&2\nexit 1\n`,
      { mode: 0o755 },
    );
    return mockDir;
  }

  // ── Cypher-shell path ───────────────────────────────────────────────────────

  it('node MERGE on cypher-shell path uses bare {id: ...} (not :Codebase {id: ...})', () => {
    writeGraph([
      { id: 'class:src/Foo.groovy:Foo', name: 'Foo', type: 'class', summary: 's', tags: [] },
    ]);

    const mockDir = createEchoingCypherShell();

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    // The MERGE for the node must be on bare {id: '...'}, not :Codebase {id: ...}
    expect(result.stderr).toMatch(/MERGE \(n \{id: 'class:src\/Foo\.groovy:Foo'\}\)/);
    expect(result.stderr).not.toMatch(/MERGE \(n:Codebase \{id:/);
    // SET n:Codebase and SET n:`Class` must appear as separate SET clauses
    expect(result.stderr).toMatch(/SET n:Codebase/);
    expect(result.stderr).toMatch(/SET n:`Class`/);
  });

  it('layer MERGE on cypher-shell path uses bare {id: ...} (not :Layer:Codebase {id: ...})', () => {
    writeGraph(
      [{ id: 'class:src/Foo.groovy:Foo', name: 'Foo', type: 'class', summary: 's', tags: [] }],
      [],
      [{ id: 'layer:domain', name: 'Domain', description: '', nodeIds: [] }],
    );

    const mockDir = createEchoingCypherShell();

    const result = runPushCodebaseGraph(root, {
      NEO4J_URI: 'neo4j://localhost:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'password',
      NEO4J_DATABASE: 'grasp',
      NEO4J_CONNECTION_TYPE: 'cypher-shell',
      PATH: `${mockDir}:/usr/local/bin:/usr/bin:/bin`,
    });

    rmSync(mockDir, { recursive: true, force: true });

    expect(result.stderr).toMatch(/MERGE \(l \{id: 'layer:domain'\}\)/);
    expect(result.stderr).not.toMatch(/MERGE \(l:Layer:Codebase \{id:/);
    expect(result.stderr).not.toMatch(/MERGE \(l:Codebase:Layer \{id:/);
    // SET l:Codebase and SET l:Layer must appear as separate SET clauses
    expect(result.stderr).toMatch(/SET l:Codebase/);
    expect(result.stderr).toMatch(/SET l:Layer/);
  });

  // ── Bolt driver path ────────────────────────────────────────────────────────
  //
  // The driver path runs the same MERGE templates via session.run(). Because
  // the templates are inline in the source file, we verify them by reading
  // the source and asserting the literal template substrings.

  it('node MERGE on Bolt driver path uses bare {id: $id} (not :Codebase {id: $id})', () => {
    writeGraph([
      { id: 'class:src/Bar.groovy:Bar', name: 'Bar', type: 'class', summary: 's', tags: [] },
    ]);

    // readFileSync is imported at the top of the file (added by the implementer
    // alongside the existing imports from "node:fs").
    const source = readFileSync(SCRIPT_PATH, 'utf-8');

    // Driver path node MERGE template must use bare {id: $id}
    expect(source).toMatch(/MERGE \(n \{id: \$id\}\) SET n:Codebase SET n:`\$\{secondaryLabel\}` SET n \+= \$props/);
    // Composite-label MERGE must NOT appear
    expect(source).not.toMatch(/MERGE \(n:Codebase \{id: \$id\}\) SET n \+= \$props/);
  });

  it('layer MERGE on Bolt driver path uses bare {id: $layerId} (not :Layer:Codebase {id: $layerId})', () => {
    writeGraph(
      [{ id: 'class:src/Baz.groovy:Baz', name: 'Baz', type: 'class', summary: 's', tags: [] }],
      [],
      [{ id: 'layer:app', name: 'App', description: '', nodeIds: [] }],
    );

    const source = readFileSync(SCRIPT_PATH, 'utf-8');

    // Driver path layer MERGE template must use bare {id: $layerId}
    expect(source).toMatch(/MERGE \(l \{id: \$layerId\}\) SET l:Codebase SET l:Layer/);
    // Composite-label MERGE must NOT appear
    expect(source).not.toMatch(/MERGE \(l:Layer:Codebase \{id: \$layerId\}\)/);
  });
});
```

- [ ] **Step 3: Verify the new tests fail (red)**

Run: `pnpm test -- tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs`

Expected: 4 new tests FAIL. The two cypher-shell tests fail because the MERGE template still contains `:Codebase {id:` and `:Layer:Codebase {id:`. The two driver tests fail because the source file still contains the old composite-label templates. Existing tests in the file should still pass.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs
git commit -m "test: add regression tests for MERGE-on-bare-id pattern

Adds 4 tests under REGRESSION: MERGE-on-bare-id ... :
- 2 cypher-shell tests (nodes + layers) that capture the generated
  Cypher via a mock cypher-shell reading stdin
- 2 driver-path tests that assert the source-file templates use
  bare {id: \$id} and {id: \$layerId} MERGE patterns

All 4 fail today against the buggy MERGE-on-composite-label templates.
They will pass after the push-codebase-graph.mjs fix in the next commit.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Fix the MERGE pattern in push-codebase-graph.mjs

**Files:**
- Modify: `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs:136` (cypher-shell node MERGE)
- Modify: `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs:174` (cypher-shell layer MERGE)
- Modify: `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs:423` (driver node MERGE)
- Modify: `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs:453` (driver layer MERGE)

**Purpose:** Replace composite-label MERGE templates with bare-id MERGE templates. Labels are added via separate `SET n:Label` clauses. This eliminates the constraint violation when a pre-existing node lacks one of the labels.

**Interfaces:**
- Consumes: same call sites as before — `node.id`, `secondaryLabel`, `props`, `layer.id`, `layer.name`, `layer.description`.
- Produces: same Neo4j side effect — nodes with `Codebase` + secondary label, layers with `Codebase` + `Layer` labels, all properties set.

- [ ] **Step 1: Fix the cypher-shell node MERGE (line 136)**

In `grasp-it-plugin/skills/grasp/push-codebase-graph.mjs`, replace the line:

```javascript
      // Dual-label pattern: MERGE Codebase base label, then add secondary label
      lines.push(
        `MERGE (n:Codebase {id: ${cypherEscape(node.id)}}) SET n += {${setParts}} SET n:\`${secondaryLabel}\`;`
      );
```

with:

```javascript
      // Merge on bare {id: ...} so pre-existing nodes (with or without the
      // Codebase label) are matched and upgraded in place. SET n:Codebase
      // and SET n:`<secondaryLabel>` are idempotent label assignments.
      lines.push(
        `MERGE (n {id: ${cypherEscape(node.id)}}) SET n:Codebase SET n:\`${secondaryLabel}\` SET n += {${setParts}};`
      );
```

- [ ] **Step 2: Fix the cypher-shell layer MERGE (line 174)**

Replace:

```javascript
        `MERGE (l:Layer:Codebase {id: ${cypherEscape(layer.id)}}) SET l += {name: ${cypherEscape(layer.name || "")}, description: ${cypherEscape(layer.description || "")}, kind: "codebase"};`
```

with:

```javascript
        `MERGE (l {id: ${cypherEscape(layer.id)}}) SET l:Codebase SET l:Layer SET l += {name: ${cypherEscape(layer.name || "")}, description: ${cypherEscape(layer.description || "")}, kind: "codebase"};`
```

- [ ] **Step 3: Fix the driver node MERGE (line 423)**

Replace:

```javascript
          // Dual-label pattern: MERGE Codebase base label, then add secondary label
          await session.run(
            `MERGE (n:Codebase {id: $id}) SET n += $props SET n:\`${secondaryLabel}\``,
            { id: node.id, props }
          );
```

with:

```javascript
          // Merge on bare {id: $id} so pre-existing nodes (with or without
          // the Codebase label) are matched and upgraded in place.
          await session.run(
            `MERGE (n {id: $id}) SET n:Codebase SET n:\`${secondaryLabel}\` SET n += $props`,
            { id: node.id, props }
          );
```

- [ ] **Step 4: Fix the driver layer MERGE (line 453)**

Replace:

```javascript
          // MERGE the Layer node with dual labels: Layer + Codebase
          await session.run(
            `MERGE (l:Layer:Codebase {id: $layerId})
             SET l += {name: $name, description: $description, kind: "codebase"}`,
            {
              layerId: layer.id,
              name: layer.name || "",
              description: layer.description || "",
            }
          );
```

with:

```javascript
          // Merge on bare {id: $layerId} so pre-existing nodes (with or
          // without the Codebase or Layer labels) are matched and upgraded
          // in place.
          await session.run(
            `MERGE (l {id: $layerId})
             SET l:Codebase SET l:Layer
             SET l += {name: $name, description: $description, kind: "codebase"}`,
            {
              layerId: layer.id,
              name: layer.name || "",
              description: layer.description || "",
            }
          );
```

- [ ] **Step 5: Verify the new tests pass (green)**

Run: `pnpm test -- tests/skill/grasp/test_push_codebase_graph_cypher_bugs.test.mjs`

Expected: all 4 new REGRESSION tests PASS. All pre-existing tests in the file still pass.

- [ ] **Step 6: Verify the full test suite has no regressions**

Run: `pnpm test`

Expected: every test passes. If any pre-existing test fails, the MERGE-pattern change has unintended side effects — investigate before committing.

- [ ] **Step 7: Commit the fix**

```bash
git add grasp-it-plugin/skills/grasp/push-codebase-graph.mjs
git commit -m "fix(push-codebase-graph): merge on bare {id: ...} to avoid label-conflict constraint violation

Previously the script used MERGE (n:Codebase {id: \$id}) and
MERGE (l:Layer:Codebase {id: \$layerId}). When a pre-existing node with
the same id lacked one of the labels, MERGE created a new node, and
SET n:SecondaryLabel violated the unique index on SecondaryLabel.id.

Fix: MERGE on bare {id: ...} so any existing node (regardless of its
current labels) is matched and upgraded in place. SET n:Codebase
and SET n:\`<secondaryLabel>\` are idempotent label assignments.

Affected locations (4):
- push-codebase-graph.mjs:136  (cypher-shell, nodes)
- push-codebase-graph.mjs:174  (cypher-shell, layers)
- push-codebase-graph.mjs:423  (driver, nodes)
- push-codebase-graph.mjs:453  (driver, layers)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add policy guardrails to SKILL.md (Fixes 1, 3, 4)

**Files:**
- Modify: `grasp-it-plugin/skills/grasp/SKILL.md:571-573` (Fix 1: scoped-run DELETE prohibition)
- Modify: `grasp-it-plugin/skills/grasp/SKILL.md` (insert new top-level `## Hard Rules` section between lines 40 and 44) (Fix 3 part 1)
- Modify: `grasp-it-plugin/skills/grasp/SKILL.md` (insert new subsection in Phase 6 immediately before the `**Node update strategy:**` block at line 1107) (Fix 3 part 2 + Fix 4)

**Purpose:** Encode the destructive-operation policy directly in the skill definition so that any future Claude session reading SKILL.md sees and follows the prohibition, confirmation gate, and exact-ID scoping rule.

**Interfaces:**
- Consumes: existing SKILL.md structure (Phase 0 begins at line 44, scoped-run decision table at lines 571-573, Phase 6 Save section around line 1100).
- Produces: three policy guardrails in SKILL.md; no runtime change.

- [ ] **Step 1: Apply Fix 1 — scoped-run DELETE prohibition (lines 571-573)**

Open `grasp-it-plugin/skills/grasp/SKILL.md`. Locate line 573:

```
   **Note on `--files` scope:** The `--files` option overrides file discovery to analyze only the listed paths. It does NOT change the decision-logic branch — a `--files` run with an existing graph still follows the table above. However, when `--files` is combined with an existing graph, the analysis is treated as a targeted update of only the listed files; the `push-codebase-graph.mjs` script updates nodes in place via `MERGE` rather than deleting all Codebase nodes first.
```

Immediately AFTER line 573 (before the next line), insert a blank line followed by this block:

```
   **Hard rule on `--files` scope:** **NEVER issue `DELETE` or `DETACH DELETE` during a `--files`-scoped run.** A scoped run may only `MERGE` or `SET` on the exact node IDs present in the assembled graph. Any node not in the assembled graph — including nodes inside the same directory tree as a scoped file — must be left completely untouched. If a constraint error occurs, fix it by upgrading the existing node in place (e.g., `MATCH (n {id: ...}) SET n:Codebase SET n:\`Class\` SET n += ...`), never by deleting.
```

- [ ] **Step 2: Apply Fix 3 part 1 — new top-level Hard Rules section**

Locate line 40 (the end of `## Progress Reporting`) and line 44 (the start of `## Phase 0 — Pre-flight`). Insert a new top-level section between them. The blank line at line 41-43 is the insertion point.

Insert this block:

```

## Hard Rules

These rules apply to every phase, every run mode (full and scoped), and override any "faster" shortcut.

**Destructive graph operations.** Before any `DELETE` or `DETACH DELETE` — at any phase, in any run mode (full or scoped) — the skill must:
1. Print the exact list of node `id` values that will be deleted.
2. Display the count and a one-line summary (e.g., "210 nodes across 18 files").
3. Wait for explicit user confirmation ("yes, proceed").
4. Proceed only after confirmation. If unsure, abort and ask.

If a constraint error or other failure occurs, the correct response is to fix the underlying issue (typically by upgrading the existing node in place via `MERGE` or `SET`), not to delete nodes.

```

- [ ] **Step 3: Apply Fix 3 part 2 + Fix 4 — Phase 6 destructive-ops subsection**

Locate line 1107 in SKILL.md:

```
   **Node update strategy:** The script uses `MERGE` on node IDs to update existing nodes in place — it does NOT delete all Codebase nodes before inserting. This means:
```

Immediately BEFORE that line (after the preceding blank line), insert:

```

   **Before any `DELETE` operation in Phase 6:** print the exact node IDs to be deleted, the count, and require explicit user confirmation (see the top-level Hard Rules). If the user does not confirm, abort the push and leave the graph untouched.

   **Scope of any `DELETE` query:** match exclusively on the exact set of `id` values from the assembled graph. NEVER use `STARTS WITH` prefix patterns, directory paths, or any wildcard. A single prefix match can destroy hundreds of unrelated nodes.

```

- [ ] **Step 4: Verify the SKILL.md edits**

Read back the three modified regions of SKILL.md to confirm the inserted text matches the plan exactly:

Run: `grep -n "Hard rule on \`--files\` scope\|## Hard Rules\|Before any \`DELETE\` operation in Phase 6\|Scope of any \`DELETE\` query" grasp-it-plugin/skills/grasp/SKILL.md`

Expected: four matches, one per inserted block (Fix 1 scoped-run prohibition, Fix 3 top-level Hard Rules heading, Fix 3 Phase 6 subsection, Fix 4 exact-ID scoping).

- [ ] **Step 5: Commit the policy changes**

```bash
git add grasp-it-plugin/skills/grasp/SKILL.md
git commit -m "docs(skill): add hard rules against destructive DELETE operations

Three guardrails prevent the kind of broad DELETE that destroyed 210
nodes during a --files-scoped run:

1. Scoped-run prohibition (lines 571-573): NEVER issue DELETE or
   DETACH DELETE during a --files-scoped run. Only MERGE/SET on the
   exact IDs in the assembled graph.

2. Top-level Hard Rules section: requires explicit user confirmation
   before any DELETE, in any phase, in any run mode.

3. Phase 6 subsection: requires the same confirmation gate plus a
   strict rule that DELETE must match exact id values — never STARTS
   WITH prefixes, directory paths, or wildcards.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Checklist

Run after writing the plan; verify before offering execution.

**Spec coverage:**
- Fix 1 (prohibit DELETE in --files runs) → Task 3 Step 1
- Fix 2 (MERGE pattern) → Task 1 (tests) + Task 2 (fix)
- Fix 3 (confirmation gate) → Task 3 Step 2 (top-level) + Step 3 (Phase 6)
- Fix 4 (exact-ID scoping) → Task 3 Step 3
- Regression tests → Task 1

**Placeholders:** none.

**Type consistency:** the test file already imports `mkdtempSync, writeFileSync, rmSync, mkdirSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`. Task 1 Step 2 uses only these existing imports plus `import { readFileSync } from 'node:fs'` (added inline via the destructure pattern). No new top-level imports required.

**Mock script:** the mock cypher-shell in Task 1 uses `cat >&2; exit 1`. This reads stdin (where `push-codebase-graph.mjs` writes its query via `execFileSync`'s `input: query` option) and writes it to stderr. The exit code 1 ensures the script reports a cypher-shell failure (matching existing test behavior) so stderr is flushed.