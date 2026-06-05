/**
 * Tests for the build_plugin() function in install.sh.
 *
 * Regression: pnpm --filter @grasp-it/core build was previously run OUTSIDE
 * the `cd "$REPO_DIR"` subshell, meaning it could pick up the caller's global
 * pnpm workspace instead of the cloned repo.  The fix wraps both `pnpm install`
 * and `pnpm --filter … build` inside one `(cd "$REPO_DIR" && …)` subshell.
 *
 * Test strategy
 * ─────────────
 * We source only the build_plugin() function from install.sh (we skip `main`
 * by sourcing it with a guard), override REPO_DIR with a temp directory, and
 * place a fake `pnpm` stub earlier on PATH that logs its working directory and
 * arguments to a file.  After calling build_plugin we assert:
 *
 *   1. pnpm was called at least once.
 *   2. Every pnpm invocation happened from $REPO_DIR (not the caller's cwd).
 *   3. At least one invocation contained "--filter @grasp-it/core".
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
 * Run build_plugin() in a sub-bash process with mocked dependencies.
 *
 * @param {string} repoDir   - path to use as REPO_DIR (temp dir)
 * @param {string} binDir    - directory containing stub executables on PATH
 * @param {string} logFile   - file the pnpm stub writes invocation records to
 * @param {object} opts
 * @param {boolean} opts.coreBuildExists - if true, pre-create the core/dist/index.js
 *                                         so build_plugin skips the build
 */
function runBuildPlugin(repoDir, binDir, logFile, { coreBuildExists = false } = {}) {
  if (coreBuildExists) {
    const distDir = join(repoDir, 'grasp-it-plugin', 'packages', 'core', 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.js'), '// pre-built\n', 'utf-8');
  }

  // Bash fragment: extract only the build_plugin() function definition from
  // install.sh using awk (avoids sourcing the whole file and triggering the
  // "main $@" call at the bottom), then invoke it.
  //
  // Note: no backtick characters in this array — they confuse Rollup's JS
  //       parser when Vitest transforms the file.
  const bashScript = [
    'set -euo pipefail',
    '',
    '# Override globals that install.sh reads inside build_plugin',
    'export REPO_DIR=' + JSON.stringify(repoDir),
    '',
    '# Extract and eval only the build_plugin function from install.sh.',
    '# We use awk to pull out lines from "^build_plugin()" to the closing "^}"',
    '# so we never execute "main $@" at the bottom of the file.',
    'eval "$(awk \'/^build_plugin\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    '',
    '# Now exercise the function under test',
    'build_plugin',
  ].join('\n');

  return spawnSync('bash', ['-c', bashScript], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      // Put our stub bin dir first so 'pnpm' resolves to the stub
      PATH: `${binDir}:${process.env.PATH}`,
      // Keep HOME so bash initialisation doesn't break
      HOME: process.env.HOME,
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a `pnpm` stub script that appends a JSON record (cwd + args) to
 * `logFile` and exits 0.
 */
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
 * Create a `git` stub that always exits 0 (used by clone_or_update which we
 * don't call here, but install.sh sources it unconditionally).
 */
function makeGitStub(binDir) {
  const stubPath = join(binDir, 'git');
  writeFileSync(stubPath, '#!/usr/bin/env bash\nexit 0\n', 'utf-8');
  chmodSync(stubPath, 0o755);
}

/** Parse the log file into an array of {cwd, args} records. */
function readLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('build_plugin() in install.sh', () => {
  let tmpDir;
  let repoDir;
  let binDir;
  let logFile;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'grasp-install-test-'));
    repoDir = join(tmpDir, 'repo');
    binDir = join(tmpDir, 'bin');
    logFile = join(tmpDir, 'pnpm-calls.log');

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    makePnpmStub(binDir, logFile);
    makeGitStub(binDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('calls pnpm at least once when core/dist/index.js does not exist', () => {
    const result = runBuildPlugin(repoDir, binDir, logFile);

    expect(result.status).toBe(0);
    const calls = readLog(logFile);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('runs every pnpm invocation from $REPO_DIR, not the caller working directory', () => {
    const result = runBuildPlugin(repoDir, binDir, logFile);

    expect(result.status).toBe(0);
    const calls = readLog(logFile);
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(call.cwd).toBe(repoDir);
    }
  });

  it('includes --filter @grasp-it/core in a pnpm invocation from $REPO_DIR', () => {
    const result = runBuildPlugin(repoDir, binDir, logFile);

    expect(result.status).toBe(0);
    const calls = readLog(logFile);

    const buildCall = calls.find(c => c.args.includes('--filter') && c.args.includes('@grasp-it/core'));
    expect(buildCall).toBeDefined();
    expect(buildCall.cwd).toBe(repoDir);
  });

  it('skips pnpm entirely when core/dist/index.js already exists', () => {
    const result = runBuildPlugin(repoDir, binDir, logFile, { coreBuildExists: true });

    expect(result.status).toBe(0);
    const calls = readLog(logFile);
    // build_plugin bails early — pnpm must not have been called at all
    expect(calls.length).toBe(0);
  });

  it('does not call pnpm from the test process cwd (regression guard)', () => {
    // The bug: `pnpm --filter @grasp-it/core build` ran outside the subshell,
    // so it would execute from wherever the installer was invoked (i.e. the
    // caller's working directory), not from $REPO_DIR.
    const result = runBuildPlugin(repoDir, binDir, logFile);

    expect(result.status).toBe(0);
    const calls = readLog(logFile);
    expect(calls.length).toBeGreaterThan(0);

    const callerCwd = process.cwd();
    const wrongCwdCalls = calls.filter(c => c.cwd === callerCwd);
    expect(wrongCwdCalls).toHaveLength(0);
  });
});
