/**
 * Tests for BUG-04: post-push orphan detection in Phase 6 of SKILL.md.
 *
 * SKILL.md Phase 6 step 2.5 runs a Cypher query against Neo4j to count
 * :Codebase nodes that have no relationships (degree-0 orphans from prior
 * scoped runs that used MERGE), parses the JSON output via grep -oE,
 * and emits a warning iff the count is > 0.
 *
 * These tests extract that exact bash block from SKILL.md and execute it
 * with a mock cypher-shell in PATH. The mock captures the query and
 * produces canned `--format plain` output to stdout. After running,
 * we read `ORPHAN_COUNT` and the emitted warning from the bash stdout so
 * we can pin down behavior without baking a copy of the block into JS.
 *
 * The bash block is best-effort: if Neo4j is unavailable, the parse
 * yields no number, OR cypher-shell is missing, `ORPHAN_COUNT` defaults
 * to 0 and no warning is emitted.
 *
 * The block is executed AS-IS from SKILL.md (preserving its 3-space
 * list indentation). The block uses only bash built-ins and grep — no
 * Python — so the indentation does not cause a parse error. This is the
 * whole point of the fix: the previous Python-based block silently
 * failed with IndentationError, swallowing the warning.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILL_MD = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/SKILL.md');
const RUN_QUERY = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs');

/**
 * Extract the orphan-check bash block from SKILL.md Phase 6 step 2.5
 * AS-IS, preserving its markdown list indentation.
 *
 * The block in SKILL.md lives inside a numbered list item, so every line
 * is indented by 3 spaces. The previous Python-based block was broken
 * by this (Python rejects indented scripts run via `-c`), but the new
 * grep-only block is robust to leading whitespace because each pipeline
 * stage operates on a line at a time.
 *
 * The block is delimited by the line containing
 * `ORPHAN_JSON=$(node <SKILL_DIR>/run-query.mjs` and the first standalone
 * `fi` line after that.
 */
function extractOrphanCheckBlock(skillMdText) {
  const lines = skillMdText.split('\n');
  const startIdx = lines.findIndex((l) => l.includes('ORPHAN_JSON=$(node <SKILL_DIR>/run-query.mjs'));
  if (startIdx === -1) {
    throw new Error('Could not locate ORPHAN_JSON= line in SKILL.md');
  }
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === 'fi') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new Error('Could not locate closing fi in orphan-check block of SKILL.md');
  }
  return lines.slice(startIdx, endIdx + 1).join('\n');
}

/**
 * Build a wrapper that runs the orphan-check bash block and prints its
 * outcome to stdout. We append `echo` lines so the test can read
 * ORPHAN_COUNT and the warning presence without re-implementing the
 * warning logic in JS.
 *
 * SKILL_DIR and PROJECT_ROOT are injected via env vars, so we swap the
 * literal `<SKILL_DIR>` token and `$PROJECT_ROOT` references for env-var
 * expansions.
 */
function wrapBlockForTest(bashBlock) {
  const tokenSwap = bashBlock
    .replace(/<SKILL_DIR>/g, '"$SKILL_DIR"')
    .replace(/"\$PROJECT_ROOT"/g, '"$PROJECT_ROOT"')
    .replace(/\$PROJECT_ROOT/g, '"$PROJECT_ROOT"');

  return `
set -u
export SKILL_DIR PROJECT_ROOT

${tokenSwap}

# Echo outcome to stdout so the test can read it without re-implementing
# the warning logic in JS.
echo "ORPHAN_COUNT=\${ORPHAN_COUNT:-0}"
if [ "\${ORPHAN_COUNT:-0}" -gt 0 ]; then
  echo "WARNING_EMITTED=1"
else
  echo "WARNING_EMITTED=0"
fi
`;
}

/**
 * Install a mock cypher-shell that captures the stdin query to a sidecar
 * file (so the test can verify what was sent even though the bash block
 * uses `2>/dev/null`) and writes canned plain output to stdout.
 *
 * The plain output format is what run-query.mjs's
 * parseCypherShellPlainOutput() expects:
 *   - line 1: header (keys from first record)
 *   - line 2..N: comma-joined values per record
 *
 * Usage: installMockCypherShell(mockDir, plainOutput, sidecarPath?)
 * If sidecarPath is provided, the mock appends its stdin (the cypher
 * query) to that file on each invocation.
 */
function installMockCypherShell(mockDir, plainOutput, sidecarPath) {
  const sidecarLine = sidecarPath
    ? `cat >> "${sidecarPath}" 2>/dev/null`
    : `: # no sidecar configured`;
  const script = `#!/bin/sh
${sidecarLine}
cat <<'PLAIN_EOF'
${plainOutput}
PLAIN_EOF
`;
  writeFileSync(join(mockDir, 'cypher-shell'), script, { mode: 0o755 });
}

function runOrphanCheckBlock(bashBlock, projectRoot, skillDir, mockDirOrNull) {
  const wrapped = wrapBlockForTest(bashBlock);
  const env = { ...process.env };
  env.SKILL_DIR = skillDir;
  env.PROJECT_ROOT = projectRoot;
  if (mockDirOrNull !== null) {
    env.PATH = `${mockDirOrNull}:${env.PATH}`;
  } else {
    // No cypher-shell available — point PATH at minimal system dirs.
    env.PATH = '/usr/bin:/bin';
  }
  // Force cypher-shell path inside run-query.mjs. Without this the script
  // would try the neo4j-driver path first and exit 2 on missing driver.
  env.NEO4J_CONNECTION_TYPE = 'cypher-shell';
  env.NEO4J_URI = 'bolt://localhost:7687';
  env.NEO4J_USERNAME = 'neo4j';
  env.NEO4J_PASSWORD = 'password';

  return spawnSync('bash', ['-c', wrapped], {
    encoding: 'utf-8',
    env,
    timeout: 15_000,
    input: '',
  });
}

function parseOutcome(stdout) {
  const lines = stdout.split('\n').filter((l) => l.startsWith('ORPHAN_COUNT=') || l.startsWith('WARNING_EMITTED='));
  const out = { orphanCount: null, warningEmitted: null };
  for (const line of lines) {
    if (line.startsWith('ORPHAN_COUNT=')) {
      out.orphanCount = parseInt(line.slice('ORPHAN_COUNT='.length).trim(), 10);
    } else if (line.startsWith('WARNING_EMITTED=')) {
      out.warningEmitted = line.slice('WARNING_EMITTED='.length).trim() === '1';
    }
  }
  return out;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('BUG-04: post-push orphan detection (Phase 6 step 2.5)', () => {
  let root;
  let mockDir;
  let origPath;
  let bashBlock;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orphan-'));
    mockDir = mkdtempSync(join(tmpdir(), 'orphan-mock-'));
    origPath = process.env.PATH;
    mkdirSync(join(root, '.grasp-it'), { recursive: true });
    bashBlock = extractOrphanCheckBlock(readFileSync(SKILL_MD, 'utf-8'));
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (mockDir) rmSync(mockDir, { recursive: true, force: true });
    process.env.PATH = origPath;
  });

  it('Mock cypher-shell returns orphan count of 7 → ORPHAN_COUNT=7 and warning emitted', () => {
    installMockCypherShell(mockDir, 'orphanCount\n7\n');

    const result = runOrphanCheckBlock(bashBlock, root, dirname(RUN_QUERY), mockDir);
    // The bash block uses `2>/dev/null` so even if run-query.mjs fails
    // the wrapper completes.
    expect(result.status).toBe(0);

    const outcome = parseOutcome(result.stdout);
    expect(outcome.orphanCount).toBe(7);
    expect(outcome.warningEmitted).toBe(true);

    // The bash block prints the warning with a leading emoji + count.
    expect(result.stdout).toMatch(/⚠ 7 orphan node\(s\)/);
  });

  it('Mock cypher-shell returns orphan count of 0 → ORPHAN_COUNT=0 and NO warning', () => {
    installMockCypherShell(mockDir, 'orphanCount\n0\n');

    const result = runOrphanCheckBlock(bashBlock, root, dirname(RUN_QUERY), mockDir);
    expect(result.status).toBe(0);

    const outcome = parseOutcome(result.stdout);
    expect(outcome.orphanCount).toBe(0);
    expect(outcome.warningEmitted).toBe(false);

    // No "⚠" warning should appear in stdout.
    expect(result.stdout).not.toMatch(/⚠/);
  });

  it('Mock cypher-shell returns empty results → defaults gracefully to ORPHAN_COUNT=0', () => {
    // Empty plain output: header-only "orphanCount" with no data rows.
    // parseCypherShellPlainOutput returns [] in that case, run-query.mjs
    // emits JSON with results:[], and the grep pipeline matches nothing
    // so ORPHAN_COUNT defaults to 0 via `[ -z ... ] && ORPHAN_COUNT=0`.
    installMockCypherShell(mockDir, 'orphanCount\n');

    const result = runOrphanCheckBlock(bashBlock, root, dirname(RUN_QUERY), mockDir);
    expect(result.status).toBe(0);

    const outcome = parseOutcome(result.stdout);
    expect(outcome.orphanCount).toBe(0);
    expect(outcome.warningEmitted).toBe(false);
  });

  it('Mock cypher-shell returns malformed JSON → defaults gracefully to ORPHAN_COUNT=0', () => {
    // Mock emits raw junk to stdout that is not JSON. The grep pipeline
    // matches nothing so ORPHAN_COUNT defaults to 0 via the
    // `[ -z ... ] && ORPHAN_COUNT=0` fallback.
    installMockCypherShell(mockDir, 'not valid json at all');

    const result = runOrphanCheckBlock(bashBlock, root, dirname(RUN_QUERY), mockDir);
    expect(result.status).toBe(0);

    const outcome = parseOutcome(result.stdout);
    expect(outcome.orphanCount).toBe(0);
    expect(outcome.warningEmitted).toBe(false);
  });

  it('Mock cypher-shell binary not found → completes with ORPHAN_COUNT=0 (best-effort)', () => {
    // No mockDir in PATH — cypher-shell is not available. run-query.mjs
    // exits 2 (cypher-shell fallback signal) but the bash block uses
    // 2>/dev/null + the `[ -z ... ] && ORPHAN_COUNT=0` fallback so this
    // must not crash.
    const result = runOrphanCheckBlock(bashBlock, root, dirname(RUN_QUERY), null);
    expect(result.status).toBe(0);

    const outcome = parseOutcome(result.stdout);
    expect(outcome.orphanCount).toBe(0);
    expect(outcome.warningEmitted).toBe(false);
  });

  it('Cypher query sent to cypher-shell matches the documented one', () => {
    // The mock captures its stdin (the cypher query) to a sidecar file so
    // the test can read it even though the bash block uses 2>/dev/null
    // (which suppresses run-query.mjs's stderr).
    const sidecar = join(mockDir, 'captured-query.txt');
    installMockCypherShell(mockDir, 'orphanCount\n0\n', sidecar);

    const result = runOrphanCheckBlock(bashBlock, root, dirname(RUN_QUERY), mockDir);
    expect(result.status).toBe(0);

    // The cypher query that run-query.mjs forwarded to cypher-shell must
    // match the one documented in SKILL.md step 2.5.
    const captured = readFileSync(sidecar, 'utf-8');
    expect(captured).toContain('MATCH (n:Codebase)');
    expect(captured).toContain('WHERE NOT EXISTS');
    expect(captured).toContain('count(n) AS orphanCount');
  });
});

// ── Sanity check: the bash block extraction pins the SKILL.md text ───────────

describe('orphan-check block extraction (regression: SKILL.md text)', () => {
  it('SKILL.md step 2.5 contains the orphan detection block', () => {
    const skillText = readFileSync(SKILL_MD, 'utf-8');
    const block = extractOrphanCheckBlock(skillText);
    expect(block).toContain('ORPHAN_JSON=$(node');
    expect(block).toContain('run-query.mjs');
    expect(block).toContain('MATCH (n:Codebase) WHERE NOT EXISTS');
    expect(block).toContain('count(n) AS orphanCount');
    expect(block).toContain('grep -oE');
    expect(block).toContain('"orphanCount":"[0-9]+"');
    expect(block).toContain('orphanCount');
    expect(block).toMatch(/if \[\s*"\$ORPHAN_COUNT"\s+-gt 0\s*\];\s*then/);
    expect(block).toContain('⚠');
    expect(block).toMatch(/\bfi\b/);
    // Regression guard: ensure the broken Python parser was removed.
    expect(block).not.toContain('python3');
  });
});