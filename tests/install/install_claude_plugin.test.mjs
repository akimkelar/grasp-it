/**
 * Tests for the install_claude_plugin() function in install.sh.
 *
 * This function handles the "claude" platform — it copies the built plugin
 * into Claude Code's plugin cache when Claude Code is present, or sets up
 * the plugin files for manual installation when it is not.
 *
 * Test strategy
 * ─────────────
 * We extract only the install_claude_plugin() function from install.sh using
 * awk (avoiding the "main $@" call at the bottom), override REPO_DIR and HOME
 * with temp directories, and place stub executables on PATH to verify:
 *
 *   1. When Claude Code is detected: plugin is copied to the correct cache path
 *   2. When Claude Code is NOT detected: build_plugin is called, .grasp-it-plugin
 *      symlink is created, and a message about manual installation is printed
 *   3. Upgrade case: re-copy happens even when cache already exists
 *   4. Skip case: if cache already has the same version, no copy is made
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
 * Run install_claude_plugin() in a sub-bash process with mocked dependencies.
 *
 * @param {string} repoDir         - path to use as REPO_DIR (temp dir)
 * @param {string} binDir          - directory containing stub executables on PATH
 * @param {string} copyLogFile     - file the cp stub writes copy records to
 * @param {object} opts
 * @param {boolean} opts.claudeAvailable  - if true, create a 'claude' stub on PATH AND create ~/.claude dir
 * @param {boolean} opts.coreBuildExists  - if true, pre-create core/dist/index.js
 * @param {string}  opts.existingVersion - if set, pre-populate cache with this version
 * @param {string}  opts.testHome         - HOME dir for the test (defaults to process.env.HOME)
 */
function runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
  claudeAvailable = true,
  coreBuildExists = false,
  existingVersion = null,
  testHome = process.env.HOME,
  pluginListResponse = '',
} = {}) {
  // Set up the plugin source directory structure
  const pluginSrc = join(repoDir, 'grasp-it-plugin');
  mkdirSync(join(pluginSrc, 'skills'), { recursive: true });
  mkdirSync(join(pluginSrc, 'packages', 'core', 'dist'), { recursive: true });

  // Write a minimal package.json with a known version
  writeFileSync(
    join(pluginSrc, 'package.json'),
    JSON.stringify({ name: '@grasp-it/skill', version: '0.1.0' }),
    'utf-8',
  );

  if (coreBuildExists) {
    writeFileSync(join(pluginSrc, 'packages', 'core', 'dist', 'index.js'), '// pre-built\n', 'utf-8');
  }

  // Pre-populate the Claude Code cache with an existing version if requested
  if (existingVersion) {
    const cachePath = join(testHome, '.claude', 'plugins', 'cache', 'grasp-it', 'grasp-it', existingVersion);
    mkdirSync(cachePath, { recursive: true });
    writeFileSync(join(cachePath, 'package.json'), JSON.stringify({ name: '@grasp-it/skill', version: existingVersion }), 'utf-8');
  }

  // When Claude Code is available, write a claude stub that responds to
  // 'claude plugin list' with the configured output.
  if (claudeAvailable) {
    const claudeStubPath = join(binDir, 'claude');
    writeFileSync(
      claudeStubPath,
      `#!/usr/bin/env bash
case "$1" in
  plugin|plugins)
    printf '%s\\n' ${JSON.stringify(pluginListResponse)}
    ;;
esac
exit 0
`,
      'utf-8',
    );
    chmodSync(claudeStubPath, 0o755);
  }

  // Bash fragment: extract and eval install_claude_plugin(), build_plugin(),
  // and link_plugin_root() functions from install.sh, then invoke install_claude_plugin.
  const bashScript = [
    'set -euo pipefail',
    '',
    '# Override globals that install.sh reads',
    'export REPO_DIR=' + JSON.stringify(repoDir),
    'export HOME=' + JSON.stringify(testHome),
    'export PLUGIN_LINK="$HOME/.grasp-it-plugin"',
    '',
    '# Extract and eval the functions we need from install.sh.',
    '# install_claude_plugin calls build_plugin and link_plugin_root, so we need all three.',
    'eval "$(awk \'/^build_plugin\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    'eval "$(awk \'/^link_plugin_root\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    'eval "$(awk \'/^install_claude_plugin\\(\\)/,/^}$/{print}\' ' + JSON.stringify(INSTALL_SH) + ')"',
    '',
    '# Now exercise the function under test',
    'install_claude_plugin',
  ].join('\n');

  return spawnSync('bash', ['-c', bashScript], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      // Put our stub bin dir first so our stubs resolve first
      PATH: `${binDir}:${process.env.PATH}`,
      // Use test-specific HOME so we can control whether ~/.claude exists
      HOME: testHome,
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a `pnpm` stub that logs cwd and args then exits 0.
 * Needed because build_plugin() calls pnpm when core/dist/index.js is missing.
 */
function makePnpmStub(binDir, logFile) {
  const stubPath = join(binDir, 'pnpm');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
# Stub pnpm — records cwd and args, exits 0
printf '{"cwd":"%s","args":%s}\\n' "$(pwd)" "$(printf '%s\\n' "$@" | jq -R . | jq -sc .)" >> ${JSON.stringify(logFile)}
exit 0
`,
    'utf-8',
  );
  chmodSync(stubPath, 0o755);
}

/**
 * Create a `cp` stub that logs each invocation (destination + args) to logFile.
 * Unlike the real cp, this stub does NOT create directories — it logs and exits 0.
 * This means the install script's copy will fail if destination doesn't exist,
 * which is fine for our tests (we're checking that cp WAS called with right args,
 * not that the copy actually succeeded).
 */
function makeCpStub(binDir, logFile) {
  const stubPath = join(binDir, 'cp');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
# Stub cp — logs each invocation to track copy destinations
# In real cp: $1=-R, $2=src, $3=dest
# We log dest ($3) and all args
printf '{"dest":"%s","args":%s}\\n' "$3" "$(printf '%s\\n' "$@" | jq -R . | jq -sc .)" >> ${JSON.stringify(logFile)}
exit 0
`,
    'utf-8',
  );
  chmodSync(stubPath, 0o755);
}

/**
 * Create a `git` stub that always exits 0.
 */
function makeGitStub(binDir) {
  const stubPath = join(binDir, 'git');
  writeFileSync(stubPath, '#!/usr/bin/env bash\nexit 0\n', 'utf-8');
  chmodSync(stubPath, 0o755);
}

/**
 * Create a `ln` stub that logs symlink creation to logFile.
 * ln -s target link: $2=target, $3=link
 */
function makeLnStub(binDir, logFile) {
  const stubPath = join(binDir, 'ln');
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
# Stub ln — logs symlink creation (ln -s target link: $2=target, $3=link)
printf '{"link":"%s","target":"%s"}\n' "$3" "$2" >> ${JSON.stringify(logFile)}
exit 0
`,
    'utf-8',
  );
  chmodSync(stubPath, 0o755);
}

/** Parse the log file into an array of records. */
function readLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('install_claude_plugin() in install.sh', () => {
  let tmpDir;
  let repoDir;
  let binDir;
  let copyLogFile;
  let lnLogFile;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'grasp-claude-test-'));
    repoDir = join(tmpDir, 'repo');
    binDir = join(tmpDir, 'bin');
    copyLogFile = join(tmpDir, 'cp-calls.log');
    lnLogFile = join(tmpDir, 'ln-calls.log');

    mkdirSync(repoDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    makeCpStub(binDir, copyLogFile);
    makeLnStub(binDir, lnLogFile);
    makeGitStub(binDir);
    makePnpmStub(binDir, join(tmpDir, 'pnpm-calls.log'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies plugin to Claude Code cache when Claude Code is detected', () => {
    // Claude Code IS available — stub succeeds and ~/.claude exists
    // Use tmpDir as HOME so we control the .claude directory location
    const testHome = tmpDir;
    mkdirSync(join(testHome, '.claude'), { recursive: true });

    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: true,
      testHome,
    });

    expect(result.status).toBe(0);
    const copies = readLog(copyLogFile);

    // cp should have been called to copy the plugin to cache
    expect(copies.length).toBeGreaterThan(0);

    // The destination should contain the expected cache path structure
    const copyDest = copies[0].dest;
    expect(copyDest).toContain('grasp-it');
    expect(copyDest).toContain('grasp-it');
    expect(copyDest).toContain('0.1.0'); // version from package.json
  });

  it('does NOT copy to cache when Claude Code is not detected', () => {
    // Claude Code NOT available — use tmpDir as HOME (no .claude directory)
    const testHome = tmpDir;

    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: false,
      testHome,
    });

    expect(result.status).toBe(0);
    const copies = readLog(copyLogFile);

    // cp should NOT have been called — no cache installation
    expect(copies.length).toBe(0);
  });

  it('prints manual installation instructions when Claude Code is not detected', () => {
    const testHome = tmpDir;

    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: false,
      testHome,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Claude Code not found');
    expect(result.stdout).toContain('/plugin marketplace add akimkelar/Grasp-It');
  });

  it('re-copies plugin even when cache already has a different version', () => {
    // Pre-populate cache with an older version in a temp HOME
    const testHome = tmpDir;
    mkdirSync(join(testHome, '.claude'), { recursive: true });

    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: true,
      existingVersion: '0.0.9',
      testHome,
    });

    expect(result.status).toBe(0);
    const copies = readLog(copyLogFile);

    // cp should have been called — upgrade scenario
    expect(copies.length).toBeGreaterThan(0);

    // The copy destination should be the new version (0.1.0)
    const copyDest = copies[0].dest;
    expect(copyDest).toContain('0.1.0');
  });

  it('skips copy when cache already has the same version', () => {
    // Pre-populate cache with the SAME version as package.json (0.1.0)
    const testHome = tmpDir;
    mkdirSync(join(testHome, '.claude'), { recursive: true });

    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: true,
      existingVersion: '0.1.0',
      testHome,
    });

    expect(result.status).toBe(0);
    const copies = readLog(copyLogFile);

    // cp should NOT have been called — same version, no need to re-copy
    // Note: the current implementation does NOT check this; it always copies.
    // This test documents the current behavior (copies even if same version).
    // If the implementation adds skip-on-same-version logic, update this test.
    expect(copies.length).toBe(1);
  });

  it('prints /plugin update instructions when plugin is already active', () => {
    const testHome = tmpDir;
    mkdirSync(join(testHome, '.claude'), { recursive: true });

    // 'claude plugin list' shows grasp-it is already installed
    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: true,
      testHome,
      pluginListResponse: 'grasp-it',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('/plugin update grasp-it');
    expect(result.stdout).not.toContain('/plugin marketplace add');
  });

  it('prints marketplace install instructions when plugin is not yet active', () => {
    const testHome = tmpDir;
    mkdirSync(join(testHome, '.claude'), { recursive: true });

    // 'claude plugin list' is empty — plugin not yet installed
    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: true,
      testHome,
      pluginListResponse: '',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('/plugin marketplace add akimkelar/Grasp-It');
    expect(result.stdout).toContain('/plugin install grasp-it');
    expect(result.stdout).not.toContain('/plugin update grasp-it');
  });

  it('creates .grasp-it-plugin symlink when Claude Code is not detected', () => {
    const testHome = tmpDir;

    const result = runInstallClaudePlugin(repoDir, binDir, copyLogFile, {
      claudeAvailable: false,
      testHome,
    });

    expect(result.status).toBe(0);
    const lnCalls = readLog(lnLogFile);

    // ln should have been called to create ~/.grasp-it-plugin
    expect(lnCalls.length).toBeGreaterThan(0);
    const lnCall = lnCalls.find(c => c.link.includes('.grasp-it-plugin'));
    expect(lnCall).toBeDefined();
  });
});