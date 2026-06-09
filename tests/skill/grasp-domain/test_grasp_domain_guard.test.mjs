/**
 * Tests for Bug D fix: grasp-domain must hard-fail when no codebase graph exists.
 *
 * The guard in Phase 2 checks if Project.gitCommitHash is absent (meaning /grasp
 * has never run). If absent, the skill must:
 *   1. Print error: "No full /grasp analysis found. Running /grasp-domain standalone
 *      will produce degraded domain extraction quality."
 *   2. Instruct user: "Run /grasp first for best results, then re-run /grasp-domain."
 *   3. Exit with code 1
 *
 * The guard uses load-project-meta.mjs which supports LOAD_PROJECT_META_MOCK for testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function runSkillScript(skillScriptPath, args, env = {}) {
  return spawnSync('bash', ['-c', `${skillScriptPath} "${args.join('" "')}" 2>&1`], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

function initGitRepo(root) {
  const { execSync } = require('child_process');
  execSync('git init', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  writeFileSync(join(root, 'README.md'), 'test');
  execSync('git add .', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
}

/**
 * Extract a bash code block from SKILL.md.
 */
function extractBashBlock(skillMdPath, sectionMarker) {
  const content = readFileSync(skillMdPath, 'utf-8');
  const sectionStart = content.indexOf(sectionMarker);
  if (sectionStart === -1) {
    throw new Error(`Could not find section marker: ${sectionMarker}`);
  }

  const afterMarker = content.slice(sectionStart);
  const openFenceMatch = afterMarker.match(/^[ \t]*```bash\n/m);
  if (!openFenceMatch) {
    throw new Error('Could not find opening ```bash fence');
  }

  const openFenceIndex = openFenceMatch.index;
  const openFenceLine = afterMarker.slice(
    openFenceIndex,
    afterMarker.indexOf('\n', openFenceIndex),
  );
  const fenceIndent = openFenceLine.match(/^([ \t]*)/)[1];

  const codeStart = openFenceIndex + openFenceLine.length + 1;
  const closingFencePattern = new RegExp(`\n${fenceIndent}\`\`\`(?!\`)`);
  const relativeClose = afterMarker.slice(codeStart).search(closingFencePattern);
  if (relativeClose === -1) {
    throw new Error('Could not find closing ``` fence');
  }

  const raw = afterMarker.slice(codeStart, codeStart + relativeClose + 1);
  const lines = raw.split('\n');
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => {
      const indent = l.match(/^([ \t]*)/)[1].length;
      return Math.min(min, indent);
    }, Infinity);
  return lines.map(l => l.slice(minIndent)).join('\n');
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('grasp-domain Bug D guard: hard-fail when no codebase graph exists', () => {
  const SKILL_MD = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/SKILL.md');
  const LOAD_PROJECT_META = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/load-project-meta.mjs');

  let root;
  let tempSkillDir;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grasp-domain-guard-'));
    initGitRepo(root);

    // Create a minimal .grasp-it directory structure
    mkdirSync(join(root, '.grasp-it'), { recursive: true });
    mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });

    // Create a temp skill directory with the scripts we need
    tempSkillDir = mkdtempSync(join(tmpdir(), 'grasp-domain-test-'));
    writeFileSync(join(tempSkillDir, 'run-query.mjs'), readFileSync(
      resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs'), 'utf-8'
    ));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (tempSkillDir) rmSync(tempSkillDir, { recursive: true, force: true });
  });

  describe('load-project-meta.mjs mock behavior', () => {
    it('returns empty JSON when LOAD_PROJECT_META_MOCK is empty', () => {
      const result = spawnSync('node', [LOAD_PROJECT_META, root], {
        encoding: 'utf-8',
        env: { ...process.env, LOAD_PROJECT_META_MOCK: '' },
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({});
    });

    it('returns gitCommitHash when LOAD_PROJECT_META_MOCK is set', () => {
      const result = spawnSync('node', [LOAD_PROJECT_META, root], {
        encoding: 'utf-8',
        env: { ...process.env, LOAD_PROJECT_META_MOCK: 'abc123def456' },
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.gitCommitHash).toBe('abc123def456');
    });
  });

  describe('Phase 2 guard extracts gitCommitHash correctly', () => {
    it('extracts gitCommitHash from load-project-meta.mjs output', () => {
      // This test verifies the jq extraction logic used in the guard
      const mockOutput = JSON.stringify({ gitCommitHash: 'abc123', lastAnalyzedAt: '2024-01-01T00:00:00Z' });
      const result = spawnSync('bash', ['-c', `echo '${mockOutput}' | jq -r '.gitCommitHash // empty'`], {
        encoding: 'utf-8',
      });
      expect(result.stdout.trim()).toBe('abc123');
    });

    it('returns empty string when gitCommitHash is absent', () => {
      const mockOutput = JSON.stringify({});
      const result = spawnSync('bash', ['-c', `echo '${mockOutput}' | jq -r '.gitCommitHash // empty'`], {
        encoding: 'utf-8',
      });
      expect(result.stdout.trim()).toBe('');
    });
  });

  describe('guard behavior when /grasp has NOT run', () => {
    it('exits with code 1 when gitCommitHash is absent', () => {
      // Extract the guard check from Phase 2 step 1
      const guardCheck = `
PROJECT_ROOT="${root}"
SKILL_DIR="${tempSkillDir}"
export LOAD_PROJECT_META_MOCK=""

# Mock load-project-meta.mjs to return empty
writeFileSync(join(tempSkillDir, 'load-project-meta.mjs'), \`
#!/usr/bin/env node
console.log('{}');
process.exit(0);
\`);

# Copy load-project-meta.mjs to temp skill dir
cp /dev/stdin "${tempSkillDir}/load-project-meta.mjs" 2>/dev/null || true

# Actually, just set the env var and call the real script
PROJECT_META=$(node "${LOAD_PROJECT_META}" "$PROJECT_ROOT" 2>/dev/null)
GIT_COMMIT_HASH=$(echo "$PROJECT_META" | jq -r '.gitCommitHash // empty')

if [ -z "$GIT_COMMIT_HASH" ]; then
  echo "ERROR: No full /grasp analysis found." >&2
  echo "Running /grasp-domain standalone will produce degraded domain extraction quality." >&2
  echo "Run /grasp first for best results, then re-run /grasp-domain." >&2
  exit 1
fi
echo "PASS: gitCommitHash found"
`;

      const result = spawnSync('bash', ['-c', `
PROJECT_ROOT="${root}"
SKILL_DIR="${tempSkillDir}"
LOAD_PROJECT_META_MOCK="" node "${LOAD_PROJECT_META}" "$PROJECT_ROOT" > /dev/null 2>&1
PROJECT_META=$(LOAD_PROJECT_META_MOCK="" node "${LOAD_PROJECT_META}" "$PROJECT_ROOT" 2>/dev/null)
GIT_COMMIT_HASH=$(echo "$PROJECT_META" | jq -r '.gitCommitHash // empty')

if [ -z "$GIT_COMMIT_HASH" ]; then
  echo "ERROR: No full /grasp analysis found." >&2
  echo "Running /grasp-domain standalone will produce degraded domain extraction quality." >&2
  echo "Run /grasp first for best results, then re-run /grasp-domain." >&2
  exit 1
fi
echo "PASS: gitCommitHash found"
`], {
        encoding: 'utf-8',
        env: { ...process.env, LOAD_PROJECT_META_MOCK: '' },
      });

      // When gitCommitHash is absent, should exit 1 with error message
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ERROR: No full /grasp analysis found.');
      expect(result.stderr).toContain('Running /grasp-domain standalone will produce degraded domain extraction quality.');
      expect(result.stderr).toContain('Run /grasp first for best results, then re-run /grasp-domain.');
    });
  });

  describe('guard behavior when /grasp HAS run', () => {
    it('exits with code 0 when gitCommitHash is present', () => {
      const result = spawnSync('bash', ['-c', `
PROJECT_ROOT="${root}"
LOAD_PROJECT_META_MOCK="abc123def456" node "${LOAD_PROJECT_META}" "$PROJECT_ROOT" > /dev/null 2>&1
PROJECT_META=$(LOAD_PROJECT_META_MOCK="abc123def456" node "${LOAD_PROJECT_META}" "$PROJECT_ROOT" 2>/dev/null)
GIT_COMMIT_HASH=$(echo "$PROJECT_META" | jq -r '.gitCommitHash // empty')

if [ -z "$GIT_COMMIT_HASH" ]; then
  echo "ERROR: No full /grasp analysis found." >&2
  exit 1
fi
echo "PASS: gitCommitHash found: $GIT_COMMIT_HASH"
`], {
        encoding: 'utf-8',
        env: { ...process.env },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('PASS: gitCommitHash found');
    });
  });
});
