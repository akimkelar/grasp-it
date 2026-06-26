/**
 * Tests for the cmd_update() function in install.sh.
 *
 * Regression: --update used to just run `git pull --ff-only` and print
 * "Updated." — no install, no rebuild. So a new dependency added to
 * package.json between pulls would break skills with `Cannot find module`.
 *
 * Test strategy
 * ─────────────
 * We extract only the cmd_update() function from install.sh using awk
 * (avoiding the "main $@" call at the bottom), override REPO_DIR with a
 * temp directory that already contains a `.git` directory, and place stubs
 * for `git` (records invocations) and `pnpm` (records invocations) earlier
 * on PATH. After calling cmd_update we assert:
 *
 *   1. `git pull --ff-only` was called once (the repo was updated).
 *   2. `pnpm install` was called (deps synced).
 *   3. `pnpm --filter @grasp-it/core build` was called (core rebuilt).
 *   4. All pnpm invocations happened from $REPO_DIR.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INSTALL_SH = resolve(__dirname, '../../install.sh');

/**
 * Run cmd_update() in a sub-bash process with mocked dependencies.
 *
 * @param {string} repoDir   - path to use as REPO_DIR (temp dir, must contain .git)
 * @param {string} binDir    - directory containing stub executables on PATH
 * @param {string} pnpmLog   - file the pnpm stub writes invocation records to
 * @param {string} gitLog    - file the git stub writes invocation records to
 */
function runCmdUpdate(repoDir, binDir, pnpmLog, gitLog) {
  // The install script's cmd_update guards on $REPO_DIR/.git existing.
  mkdirSync(join(repoDir, '.git'), { recursive: true });

  const bashScript = [
    'set -euo pipefail',
    '',
    '# Override globals that install.sh reads',
    'export REPO_DIR=' + JSON.stringify(repoDir),
    '',
    '# Extract and eval the functions cmd_update needs.',
    '# cmd_update calls sync_deps, which calls fresh_pnpm_install.',
    'eval "$(awk \'/^fresh_pnpm_install\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    'eval "$(awk \'/^sync_deps\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    'eval "$(awk \'/^cmd_update\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    '',
    '# Now exercise the function under test',
    'cmd_update',
  ].join('\n');

  return spawnSync('bash', ['-c', bashScript], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePnpmStub(binDir, logFile) {
  const stubPath = join(binDir, 'pnpm');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
# Stub pnpm — records cwd and args, then exits 0
printf '{"cwd":"%s","args":%s}\\n' "$(pwd)" "$(printf '%s\\n' "$@" | jq -R . | jq -sc .)" \
  >> ${JSON.stringify(logFile)}
exit 0
`,
    'utf-8',
  );
  chmodSync(stubPath, 0o755);
}

/**
 * Stub git that records each invocation. Only matches `git -C <dir> pull
 * --ff-only` exactly — any other invocation still exits 0 but isn't logged.
 *
 * (Avoids backticks in the template literal because Rollup/Vite's JS parser
 * chokes on nested backticks inside template strings.)
 */
function makeGitStub(binDir, logFile) {
  const stubPath = join(binDir, 'git');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
# Stub git — records "git -C <dir> pull --ff-only" invocations
if [[ "$1" == "-C" && "$3" == "pull" && "$4" == "--ff-only" ]]; then
  printf '{"cwd":"%s","dir":"%s","subcmd":"%s"}\\n' "$(pwd)" "$2" "$3" >> ${JSON.stringify(logFile)}
fi
exit 0
`,
    'utf-8',
  );
  chmodSync(stubPath, 0o755);
}

function readLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cmd_update() in install.sh', () => {
  let tmpDir;
  let repoDir;
  let binDir;
  let pnpmLog;
  let gitLog;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'grasp-update-test-'));
    repoDir = join(tmpDir, 'repo');
    binDir = join(tmpDir, 'bin');
    pnpmLog = join(tmpDir, 'pnpm-calls.log');
    gitLog = join(tmpDir, 'git-calls.log');

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    makePnpmStub(binDir, pnpmLog);
    makeGitStub(binDir, gitLog);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs git pull --ff-only against $REPO_DIR', () => {
    const result = runCmdUpdate(repoDir, binDir, pnpmLog, gitLog);
    expect(result.status).toBe(0);

    const gitCalls = readLog(gitLog);
    expect(gitCalls.length).toBeGreaterThan(0);
    expect(gitCalls[0].dir).toBe(repoDir);
    expect(gitCalls[0].subcmd).toBe('pull');
  });

  it('calls pnpm install to sync dependencies after the pull', () => {
    const result = runCmdUpdate(repoDir, binDir, pnpmLog, gitLog);
    expect(result.status).toBe(0);

    const pnpmCalls = readLog(pnpmLog);
    const installCall = pnpmCalls.find(c => c.args.includes('install'));
    expect(installCall).toBeDefined();
    expect(installCall.cwd).toBe(repoDir);
  });

  it('rebuilds @grasp-it/core after the pull', () => {
    const result = runCmdUpdate(repoDir, binDir, pnpmLog, gitLog);
    expect(result.status).toBe(0);

    const pnpmCalls = readLog(pnpmLog);
    const buildCall = pnpmCalls.find(c => c.args.includes('--filter') && c.args.includes('@grasp-it/core'));
    expect(buildCall).toBeDefined();
    expect(buildCall.cwd).toBe(repoDir);
  });

  it('runs all pnpm invocations from $REPO_DIR', () => {
    const result = runCmdUpdate(repoDir, binDir, pnpmLog, gitLog);
    expect(result.status).toBe(0);

    const pnpmCalls = readLog(pnpmLog);
    expect(pnpmCalls.length).toBeGreaterThan(0);
    for (const call of pnpmCalls) {
      expect(call.cwd).toBe(repoDir);
    }
  });

  it('prints an Updated confirmation message', () => {
    const result = runCmdUpdate(repoDir, binDir, pnpmLog, gitLog);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Updated');
  });
});