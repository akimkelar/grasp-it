/**
 * Tests for /grasp-diff Phase 1.5 scope check.
 *
 * The scope check classifies each file in the diff into one of four buckets:
 *   - not_analyzed: no File node in the graph at all
 *   - stale: analyzedAtCommit is older than the last-modifying commit
 *   - fresh: analyzedAtCommit is at or after the last-modifying commit
 *   - unanalyzed: analyzedAtCommit is null on the File node (legacy)
 *
 * The scope check is implemented as a bash block in SKILL.md. We extract the
 * block and run it under controlled conditions (real git repo + mocked
 * analyzedAtCommit data) to verify the classification logic.
 *
 * To make the test deterministic, the bash block reads analyzedAtCommit values
 * from a `GRASP_DIFF_SCOPE_MOCK` env var when present (a JSON object mapping
 * filePath -> analyzedAtCommit | null). When unset, the block falls back to a
 * real run-query.mjs call against Neo4j.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from "node:path";
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILL_MD = resolve(
  __dirname,
  '../../../grasp-it-plugin/skills/grasp-diff/SKILL.md',
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the bash code block under a specific phase heading in SKILL.md.
 *
 * The phase heading is matched as a line starting with "### " (the level used
 * in the SKILL.md for phases). The bash block is the first ```bash fenced
 * code block under that heading, before the next ### heading.
 */
function extractPhaseBashBlock(skillMdPath, phaseHeading) {
  const content = readFileSync(skillMdPath, 'utf-8');
  const lines = content.split('\n');
  const headingIdx = lines.findIndex((l) => l.trim() === phaseHeading.trim());
  if (headingIdx === -1) {
    throw new Error(`Could not find phase heading: ${phaseHeading}`);
  }

  // Find the next ```bash fence after the heading, but stop at the next ### heading.
  let startLine = -1;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^###\s+/)) break;
    if (lines[i].match(/^```bash\s*$/)) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) {
    throw new Error(`Could not find bash code block under: ${phaseHeading}`);
  }

  // Find closing ``` fence
  let endLine = -1;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].match(/^```\s*$/)) {
      endLine = i;
      break;
    }
  }
  if (endLine === -1) {
    throw new Error(`Could not find closing fence for: ${phaseHeading}`);
  }

  return lines.slice(startLine + 1, endLine).join('\n');
}

function initGitRepo(root, files = {}) {
  execSync('git init -q', { cwd: root });
  execSync('git config user.email "test@test.com"', { cwd: root });
  execSync('git config user.name "Test"', { cwd: root });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  execSync('git add -A', { cwd: root });
  execSync('git commit -q -m "initial"', { cwd: root });
  return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf-8' }).trim();
}

function commitFile(root, name, content, message) {
  writeFileSync(join(root, name), content);
  execSync('git add -A', { cwd: root });
  execSync(`git commit -q -m "${message}"`, { cwd: root });
  return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf-8' }).trim();
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('/grasp-diff Phase 1.5 scope check', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grasp-diff-scope-'));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  describe('Phase 1.5 block exists in SKILL.md', () => {
    it('contains a "Compute diff base" sub-phase heading', () => {
      const content = readFileSync(SKILL_MD, 'utf-8');
      expect(content).toMatch(/Phase 1\.5:\s*Compute diff base/);
    });

    it('contains a per-file scope check heading under Phase 1', () => {
      const content = readFileSync(SKILL_MD, 'utf-8');
      // The scope check should be a sub-section of Phase 1 (e.g., Phase 1.6
      // or a labeled sub-phase) — not part of Phase 2.
      const phase1Block = content.match(/Phase 1:.*?(?=Phase 2:|$)/s);
      expect(phase1Block).not.toBeNull();
      expect(phase1Block[0]).toMatch(/scope check|Scope check/i);
    });

    it('does not use the global Project.gitCommitHash vs HEAD pattern', () => {
      // Regression: the brief explicitly says drop the global check.
      const content = readFileSync(SKILL_MD, 'utf-8');
      expect(content).not.toContain(
        "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash",
      );
    });

    it('retains the Project singleton existence check (precondition)', () => {
      const content = readFileSync(SKILL_MD, 'utf-8');
      expect(content).toMatch(/MATCH\s+\(p:Project\s+\{id:\s*'project:singleton'\}\)\s+RETURN\s+p/);
    });
  });

  describe('scope check classification — bash logic', () => {
    // Extract the scope-check bash block once and reuse it across tests.
    // The block must read $CHANGED_FILES (newline-delimited paths) and
    // GRASP_DIFF_SCOPE_MOCK (JSON map of path -> analyzedAtCommit | null).
    // It exports SCOPE_RESULT (machine-readable JSON array) and prints a
    // friendly table.
    let scopeBash;

    beforeEach(() => {
      scopeBash = extractPhaseBashBlock(SKILL_MD, '### Phase 1.5: Compute diff base + per-file scope check');
    });

    it('classifies "not analyzed" files (no File node in graph)', () => {
      // Repo with one file; scope mock has no entry for it.
      initGitRepo(root, { 'a.ts': 'a' });
      const mock = JSON.stringify({}); // empty — no analyzedAtCommit for a.ts

      const script = `
        GRASP_DIFF_FILES_MOCK="a.ts"
        GRASP_DIFF_SCOPE_MOCK='${mock}'
        PROJECT_ROOT="${root}"
        GRASP_SKILL_DIR="/nonexistent"
        ${scopeBash}
        echo "RESULT=$SCOPE_RESULT"
      `;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf-8',
        cwd: root,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/a\.ts.*not_analyzed/s);
    });

    it('classifies "stale" files (analyzedAtCommit older than last-modifying commit)', () => {
      const initialCommit = initGitRepo(root, { 'a.ts': 'v1' });
      commitFile(root, 'a.ts', 'v2', 'update a');
      const mock = JSON.stringify({ 'a.ts': initialCommit });

      const script = `
        GRASP_DIFF_FILES_MOCK="a.ts"
        GRASP_DIFF_SCOPE_MOCK='${mock}'
        PROJECT_ROOT="${root}"
        GRASP_SKILL_DIR="/nonexistent"
        ${scopeBash}
        echo "RESULT=$SCOPE_RESULT"
      `;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf-8',
        cwd: root,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/a\.ts.*stale/s);
    });

    it('classifies "fresh" files (analyzedAtCommit at or after last-modifying commit)', () => {
      const headCommit = initGitRepo(root, { 'a.ts': 'v1' });
      const mock = JSON.stringify({ 'a.ts': headCommit });

      const script = `
        GRASP_DIFF_FILES_MOCK="a.ts"
        GRASP_DIFF_SCOPE_MOCK='${mock}'
        PROJECT_ROOT="${root}"
        GRASP_SKILL_DIR="/nonexistent"
        ${scopeBash}
        echo "RESULT=$SCOPE_RESULT"
      `;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf-8',
        cwd: root,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/a\.ts.*fresh/s);
    });

    it('classifies "unanalyzed" files (File node exists but analyzedAtCommit is null)', () => {
      initGitRepo(root, { 'a.ts': 'v1' });
      const mock = JSON.stringify({ 'a.ts': null });

      const script = `
        GRASP_DIFF_FILES_MOCK="a.ts"
        GRASP_DIFF_SCOPE_MOCK='${mock}'
        PROJECT_ROOT="${root}"
        GRASP_SKILL_DIR="/nonexistent"
        ${scopeBash}
        echo "RESULT=$SCOPE_RESULT"
      `;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf-8',
        cwd: root,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/a\.ts.*unanalyzed/s);
    });

    it('classifies multiple files independently in one run', () => {
      const headCommit = initGitRepo(root, { 'a.ts': 'a', 'b.ts': 'bv1', 'c.ts': 'c' });
      commitFile(root, 'b.ts', 'bv2', 'update b');
      const initialCommit = execSync('git rev-list --max-parents=0 HEAD', {
        cwd: root, encoding: 'utf-8',
      }).trim().split('\n').pop();
      const mock = JSON.stringify({
        'a.ts': headCommit,
        'b.ts': initialCommit,
      });

      const script = `
        GRASP_DIFF_FILES_MOCK="a.ts
b.ts
c.ts"
        GRASP_DIFF_SCOPE_MOCK='${mock}'
        PROJECT_ROOT="${root}"
        GRASP_SKILL_DIR="/nonexistent"
        ${scopeBash}
        echo "RESULT=$SCOPE_RESULT"
      `;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf-8',
        cwd: root,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/a\.ts.*fresh/s);
      expect(result.stdout).toMatch(/b\.ts.*stale/s);
      expect(result.stdout).toMatch(/c\.ts.*not_analyzed/s);
    });

    it('exits 0 with no warnings when all files are fresh (advisory, not fatal)', () => {
      const headCommit = initGitRepo(root, { 'a.ts': 'a', 'b.ts': 'b' });
      const mock = JSON.stringify({
        'a.ts': headCommit,
        'b.ts': headCommit,
      });

      const script = `
        GRASP_DIFF_FILES_MOCK="a.ts
b.ts"
        GRASP_DIFF_SCOPE_MOCK='${mock}'
        PROJECT_ROOT="${root}"
        GRASP_SKILL_DIR="/nonexistent"
        ${scopeBash}
        echo "DONE_RC=$?"
      `;
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf-8',
        cwd: root,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(/not_analyzed|stale|unanalyzed/);
    });
  });

  describe('Phase 2 uses precomputed $CHANGED_FILES', () => {
    it('does not re-compute CHANGED_FILES — uses the value from Phase 1.5', () => {
      // Phase 2 must reference the precomputed $CHANGED_FILES from Phase 1.5
      // and must NOT re-run `git diff` to recompute the file list. The
      // DELETED_FILES computation may still live in Phase 2 because it is a
      // separate concern.
      const content = readFileSync(SKILL_MD, 'utf-8');
      // Phase 2 block content
      const phase2 = content.match(/Phase 2:[\s\S]*?(?=###\s+Phase)/);
      expect(phase2).not.toBeNull();
      // The block must mention CHANGED_FILES — i.e. rely on the precomputed
      // value rather than recomputing it.
      expect(phase2[0]).toMatch(/CHANGED_FILES/);
      // And must NOT contain `git diff` (the diff is computed once, in
      // Phase 1.5). Without this assertion a Phase 2 that mentions
      // $CHANGED_FILES but also re-runs `git diff` would still pass.
      expect(phase2[0]).not.toMatch(/git diff/);
    });
  });
});
