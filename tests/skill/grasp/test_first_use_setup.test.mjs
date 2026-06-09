/**
 * Tests for:
 *  1. neo4j-config-loader.mjs — file-based global config reading (Areas 1 & 3)
 *  2. first-use-setup.mjs     — the first-use wizard (Area 2)
 *
 * The wizard script is not a committed file — it lives as a code block inside
 * grasp-it-plugin/skills/grasp/SKILL.md. We extract it at test-time and write
 * it to a temp location before running it via spawn.
 *
 * Why a readline-patching wrapper (not spawnSync with input:) for the wizard:
 *   The wizard creates a fresh readline.Interface per question and calls
 *   rl.close() after each answer. When stdin is a simple pipe, rl.close()
 *   pauses the underlying stream, making it unavailable to the next Interface.
 *   The wrapper monkey-patches require('readline').createInterface via the CJS
 *   module cache before dynamic-importing the wizard ESM. Each patched Interface
 *   delivers its answer synchronously via setImmediate(), so there is no timing
 *   race and tests finish in ~100–200 ms each.
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract the wizard JavaScript from SKILL.md.
 * Looks for the first ```javascript ... ``` block inside the "Write the setup
 * script" section, dedents it, and returns it as a string ready to write to
 * a .mjs file.
 */
function extractWizardScript() {
  const skillMdPath = resolve(
    __dirname,
    '../../../grasp-it-plugin/skills/grasp/SKILL.md',
  );
  const content = readFileSync(skillMdPath, 'utf-8');

  const sectionMarker = 'Write the setup script to';
  const sectionStart = content.indexOf(sectionMarker);
  if (sectionStart === -1) {
    throw new Error('Could not find "Write the setup script" section in SKILL.md');
  }

  const afterMarker = content.slice(sectionStart);

  // Match an optionally-indented opening fence: e.g. "   ```javascript\n"
  const openFenceMatch = afterMarker.match(/^[ \t]*```javascript\n/m);
  if (!openFenceMatch) {
    throw new Error(
      'Could not find opening ```javascript fence in SKILL.md wizard section',
    );
  }

  const openFenceIndex = openFenceMatch.index;
  const openFenceLine = afterMarker.slice(
    openFenceIndex,
    afterMarker.indexOf('\n', openFenceIndex),
  );
  // Indent prefix of the opening fence (e.g. "   ")
  const fenceIndent = openFenceLine.match(/^([ \t]*)/)[1];

  const codeStart = openFenceIndex + openFenceLine.length + 1; // after the \n

  // Find the closing fence with the same indentation, not followed by more backticks
  const closingFencePattern = new RegExp(`\n${fenceIndent}\`\`\`(?!\`)`);
  const relativeClose = afterMarker.slice(codeStart).search(closingFencePattern);
  if (relativeClose === -1) {
    throw new Error('Could not find closing ``` fence in SKILL.md wizard section');
  }

  const raw = afterMarker.slice(codeStart, codeStart + relativeClose + 1);

  // Strip the common leading indentation (fenceIndent spaces on every non-empty line)
  const lines = raw.split('\n');
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => {
      const indent = l.match(/^([ \t]*)/)[1].length;
      return Math.min(min, indent);
    }, Infinity);
  return lines.map(l => l.slice(minIndent)).join('\n');
}

/**
 * Run the wizard script via a thin wrapper that monkey-patches
 * `readline.createInterface` to replay answers from a pre-loaded buffer.
 *
 * The wizard creates a new readline.Interface per question and calls
 * rl.close() between questions. Using a real stdin pipe causes the stream
 * to become unavailable after the first close(). Patching the module-level
 * createInterface instead gives each call an immediate answer without
 * touching the underlying stdin stream at all.
 *
 * @param {string}   wizardPath  – path to the wizard .mjs file
 * @param {string}   projectRoot – passed as argv[2]
 * @param {string[]} answers     – ordered answers (without trailing \n)
 * @param {object}   extraEnv    – additional env overrides
 * @returns {Promise<{status: number, stdout: string, stderr: string}>}
 */
function runWizard(wizardPath, projectRoot, answers, extraEnv = {}) {
  // Build a wrapper that:
  // 1. Patches readline.createInterface before the wizard loads (CJS module cache)
  // 2. Dynamically imports the wizard (ESM, but readline calls go through patched CJS)
  const wrapperCode = `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const answers = ${JSON.stringify(answers)};
let answerIdx = 0;

// Patch CJS readline before the wizard ESM module loads.
// The wizard does: import { createInterface } from 'readline'
// Under Node.js, ESM named imports from a CJS built-in go through the module
// cache, so patching the CJS export is sufficient.
const rlModule = require('readline');
const origCreateInterface = rlModule.createInterface.bind(rlModule);
rlModule.createInterface = function(opts) {
  const answer = answerIdx < answers.length ? answers[answerIdx++] : '';
  return {
    question: (q, cb) => {
      // Write the question prompt (wizard expects output to appear)
      if (opts && opts.output) opts.output.write(q);
      else process.stdout.write(q);
      // Deliver the answer asynchronously (just like real readline does)
      setImmediate(() => cb(answer));
    },
    close: () => {},
  };
};

// Now import the wizard — it will use the patched readline
await import(${JSON.stringify(pathToFileURL(wizardPath).href)});
`;

  return new Promise((resolve, reject) => {
    const wrapperPath = wizardPath + '.wrapper.mjs';
    writeFileSync(wrapperPath, wrapperCode, 'utf-8');

    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) =>
            ![
              'NEO4J_URI',
              'NEO4J_USERNAME',
              'NEO4J_PASSWORD',
              'NEO4J_CONNECTION_TYPE',
              'NEO4J_DATABASE',
            ].includes(k),
        ),
      ),
      ...extraEnv,
    };

    const proc = spawn('node', [wrapperPath, projectRoot], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      try { rmSync(wrapperPath); } catch { /* best-effort cleanup */ }
      resolve({ status: code, stdout, stderr });
    });
    proc.on('error', err => {
      try { rmSync(wrapperPath); } catch { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * Wrapper around spawnSync for config-loader shim scripts (synchronous tests).
 */
function runShim(shimPath, env = {}) {
  return spawnSync('node', [shimPath], {
    encoding: 'utf-8',
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) =>
            !['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_CONNECTION_TYPE'].includes(k),
        ),
      ),
      ...env,
    },
  });
}

/**
 * Small shim that imports getNeo4jConfig and prints the result as JSON.
 */
function makeShim(loaderPath, projectRoot) {
  return `
import { getNeo4jConfig } from ${JSON.stringify(loaderPath)};
const result = getNeo4jConfig(${JSON.stringify(projectRoot)});
process.stdout.write(JSON.stringify(result));
`;
}

// ── Extract wizard once ────────────────────────────────────────────────────────

let WIZARD_SCRIPT_CONTENT;
try {
  WIZARD_SCRIPT_CONTENT = extractWizardScript();
} catch {
  WIZARD_SCRIPT_CONTENT = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Area 1: neo4j-config-loader.mjs — file-based global config reading
// ══════════════════════════════════════════════════════════════════════════════

const CONFIG_LOADER_SCRIPTS = [
  {
    name: 'grasp',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/neo4j-config-loader.mjs'),
  },
];

describe.each(CONFIG_LOADER_SCRIPTS)(
  'neo4j-config-loader.mjs [$name] — global file (~/.grasp-it/neo4j.env)',
  ({ path: loaderPath }) => {
    let tmpHome;
    let projectRoot;
    let shimPath;

    beforeEach(() => {
      tmpHome = mkdtempSync(join(tmpdir(), 'loader-home-'));
      projectRoot = mkdtempSync(join(tmpdir(), 'loader-project-'));
      shimPath = join(tmpHome, 'shim.mjs');
    });

    afterEach(() => {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it('returns null when no config source is present', () => {
      writeFileSync(shimPath, makeShim(loaderPath, projectRoot), 'utf-8');
      const result = runShim(shimPath, { HOME: tmpHome });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toBeNull();
    });

    it('reads credentials from ~/.grasp-it/neo4j.env when no env vars or project .env', () => {
      const globalDir = join(tmpHome, '.grasp-it');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(
        join(globalDir, 'neo4j.env'),
        'NEO4J_URI=bolt://global-host:7687\nNEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\n',
        'utf-8',
      );

      writeFileSync(shimPath, makeShim(loaderPath, projectRoot), 'utf-8');
      const result = runShim(shimPath, { HOME: tmpHome });

      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout);
      expect(config).not.toBeNull();
      expect(config.NEO4J_URI).toBe('bolt://global-host:7687');
      expect(config.NEO4J_USERNAME).toBe('globaluser');
      expect(config.NEO4J_PASSWORD).toBe('globalpass');
    });

    it('project .env beats global ~/.grasp-it/neo4j.env', () => {
      const globalDir = join(tmpHome, '.grasp-it');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(
        join(globalDir, 'neo4j.env'),
        'NEO4J_URI=bolt://global-host:7687\nNEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\n',
        'utf-8',
      );

      // Project .env takes priority
      writeFileSync(
        join(projectRoot, '.env'),
        'NEO4J_URI=bolt://project-host:7687\nNEO4J_USERNAME=projectuser\nNEO4J_PASSWORD=projectpass\n',
        'utf-8',
      );

      writeFileSync(shimPath, makeShim(loaderPath, projectRoot), 'utf-8');
      const result = runShim(shimPath, { HOME: tmpHome });

      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout);
      expect(config).not.toBeNull();
      expect(config.NEO4J_URI).toBe('bolt://project-host:7687');
      expect(config.NEO4J_USERNAME).toBe('projectuser');
      expect(config.NEO4J_PASSWORD).toBe('projectpass');
    });

    it('env vars beat project .env', () => {
      writeFileSync(
        join(projectRoot, '.env'),
        'NEO4J_URI=bolt://project-host:7687\nNEO4J_USERNAME=projectuser\nNEO4J_PASSWORD=projectpass\n',
        'utf-8',
      );

      writeFileSync(shimPath, makeShim(loaderPath, projectRoot), 'utf-8');
      const result = runShim(shimPath, {
        HOME: tmpHome,
        NEO4J_URI: 'bolt://envvar-host:7687',
        NEO4J_USERNAME: 'envvaruser',
        NEO4J_PASSWORD: 'envvarpass',
      });

      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout);
      expect(config).not.toBeNull();
      expect(config.NEO4J_URI).toBe('bolt://envvar-host:7687');
      expect(config.NEO4J_USERNAME).toBe('envvaruser');
      expect(config.NEO4J_PASSWORD).toBe('envvarpass');
    });

    it('env vars beat global ~/.grasp-it/neo4j.env', () => {
      const globalDir = join(tmpHome, '.grasp-it');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(
        join(globalDir, 'neo4j.env'),
        'NEO4J_URI=bolt://global-host:7687\nNEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\n',
        'utf-8',
      );

      writeFileSync(shimPath, makeShim(loaderPath, projectRoot), 'utf-8');
      const result = runShim(shimPath, {
        HOME: tmpHome,
        NEO4J_URI: 'bolt://envvar-host:7687',
        NEO4J_USERNAME: 'envvaruser',
        NEO4J_PASSWORD: 'envvarpass',
      });

      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout);
      expect(config).not.toBeNull();
      expect(config.NEO4J_URI).toBe('bolt://envvar-host:7687');
      expect(config.NEO4J_USERNAME).toBe('envvaruser');
    });

    it('ignores global config when NEO4J_URI is missing from it', () => {
      const globalDir = join(tmpHome, '.grasp-it');
      mkdirSync(globalDir, { recursive: true });
      // Missing NEO4J_URI — should not be treated as valid config
      writeFileSync(
        join(globalDir, 'neo4j.env'),
        'NEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\n',
        'utf-8',
      );

      writeFileSync(shimPath, makeShim(loaderPath, projectRoot), 'utf-8');
      const result = runShim(shimPath, { HOME: tmpHome });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toBeNull();
    });
  },
);

// ── run-query.mjs: verify actual file read via HOME override ──────────────────

const RUN_QUERY_SCRIPTS = [
  {
    name: 'grasp',
    path: resolve(__dirname, '../../../grasp-it-plugin/skills/grasp/run-query.mjs'),
  },
];

describe.each(RUN_QUERY_SCRIPTS)(
  'run-query.mjs [$name] — reads actual ~/.grasp-it/neo4j.env via HOME override',
  ({ path: runQueryPath }) => {
    let tmpHome;
    let projectRoot;

    beforeEach(() => {
      tmpHome = mkdtempSync(join(tmpdir(), 'rq-home-'));
      projectRoot = mkdtempSync(join(tmpdir(), 'rq-project-'));
      spawnSync('git', ['init'], { cwd: projectRoot, encoding: 'utf-8' });
    });

    afterEach(() => {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it('attempts connection using global neo4j.env (exits 2 on unreachable host)', () => {
      const globalDir = join(tmpHome, '.grasp-it');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(
        join(globalDir, 'neo4j.env'),
        // Port 19999 will always refuse connections
        'NEO4J_URI=bolt://localhost:19999\nNEO4J_USERNAME=globaluser\nNEO4J_PASSWORD=globalpass\nNEO4J_CONNECTION_TYPE=driver\n',
        'utf-8',
      );

      const result = spawnSync(
        'node',
        [runQueryPath, projectRoot, 'MATCH (n) RETURN n LIMIT 0'],
        {
          encoding: 'utf-8',
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([k]) =>
                  !['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_CONNECTION_TYPE'].includes(k),
              ),
            ),
            HOME: tmpHome,
          },
        },
      );

      // Exits 2 = driver failed and signals cypher-shell fallback.
      // If it exited 0 with skipped, the file was NOT read — test would fail.
      expect(result.status).toBe(2);
    }, 15000);

    it('exits 0 with skipped when HOME has no .grasp-it/neo4j.env and no env vars', () => {
      const result = spawnSync(
        'node',
        [runQueryPath, projectRoot, 'MATCH (n) RETURN n LIMIT 0'],
        {
          encoding: 'utf-8',
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([k]) =>
                  !['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_CONNECTION_TYPE'].includes(k),
              ),
            ),
            HOME: tmpHome,
          },
        },
      );

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.skipped).toBe('no Neo4j configuration');
    });
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// Area 2: first-use-setup.mjs — wizard extraction and behavior
// ══════════════════════════════════════════════════════════════════════════════

describe('first-use-setup.mjs extraction from SKILL.md', () => {
  it('successfully extracts the wizard JavaScript from SKILL.md', () => {
    expect(WIZARD_SCRIPT_CONTENT).not.toBeNull();
    expect(typeof WIZARD_SCRIPT_CONTENT).toBe('string');
    expect(WIZARD_SCRIPT_CONTENT).toContain('async function main()');
    expect(WIZARD_SCRIPT_CONTENT).toContain('saveConfig');
    expect(WIZARD_SCRIPT_CONTENT).toContain('saveGlobalConfig');
    expect(WIZARD_SCRIPT_CONTENT).toContain('saveGlobalAppConfig');
  });
});

describe('first-use-setup.mjs — wizard behavior', () => {
  let tmpHome;
  let projectRoot;
  let wizardScriptPath;

  beforeEach(() => {
    if (!WIZARD_SCRIPT_CONTENT) return;

    tmpHome = mkdtempSync(join(tmpdir(), 'wizard-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'wizard-project-'));

    // Simulate what the LLM does at runtime: write the wizard to .grasp-it/tmp/
    const tmpDir = join(projectRoot, '.grasp-it', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    wizardScriptPath = join(tmpDir, 'first-use-setup.mjs');
    writeFileSync(wizardScriptPath, WIZARD_SCRIPT_CONTENT, 'utf-8');
  });

  afterEach(() => {
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('developer role, global save yes → creates .env, neo4j.env, config.json with role:developer', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    // Answers: role=1(developer), connType=Enter(default), uri=Enter, db=Enter, user=Enter, password=secret, global=y
    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '', '', '', '', 'secret', 'y'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);

    // .env
    const envPath = join(projectRoot, '.env');
    expect(existsSync(envPath)).toBe(true);
    const envContent = readFileSync(envPath, 'utf-8');
    expect(envContent).toContain('NEO4J_URI=bolt://localhost:7687');
    expect(envContent).toContain('NEO4J_USERNAME=neo4j');
    expect(envContent).toContain('NEO4J_PASSWORD=secret');
    expect(envContent).toContain('NEO4J_CONNECTION_TYPE=driver');

    // Global neo4j.env
    const globalEnvPath = join(tmpHome, '.grasp-it', 'neo4j.env');
    expect(existsSync(globalEnvPath)).toBe(true);
    const globalEnvContent = readFileSync(globalEnvPath, 'utf-8');
    expect(globalEnvContent).toContain('NEO4J_URI=bolt://localhost:7687');

    // config.json
    const configPath = join(tmpHome, '.grasp-it', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.role).toBe('developer');

    // ROLE sentinel in stdout
    expect(result.stdout).toContain('ROLE=developer');
  }, 10000);

  it('non-developer role, global save yes → config.json has role:non-developer, prints ROLE=non-developer', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    // Answers: role=2(non-developer), connType=Enter, uri=Enter, db=Enter, user=Enter, password=secret, global=y
    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['2', '', '', '', '', 'secret', 'y'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);

    const configPath = join(tmpHome, '.grasp-it', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.role).toBe('non-developer');

    expect(result.stdout).toContain('ROLE=non-developer');
    // Should NOT print the developer variant
    expect(result.stdout).not.toMatch(/ROLE=developer\n/);
  }, 10000);

  it('global save no → creates .env and config.json but NOT neo4j.env', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '', '', '', '', 'secret', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);

    // .env must exist
    expect(existsSync(join(projectRoot, '.env'))).toBe(true);

    // config.json must exist (role is always saved globally)
    expect(existsSync(join(tmpHome, '.grasp-it', 'config.json'))).toBe(true);

    // neo4j.env must NOT exist
    expect(existsSync(join(tmpHome, '.grasp-it', 'neo4j.env'))).toBe(false);
  }, 10000);

  it('merges role into existing ~/.grasp-it/config.json without destroying other keys', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    // Pre-create config.json with an extra key
    const configDir = join(tmpHome, '.grasp-it');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ someOtherKey: 'preserved', role: 'developer' }, null, 2) + '\n',
      'utf-8',
    );

    // Switch to non-developer
    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['2', '', '', '', '', 'secret', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);

    const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
    expect(config.role).toBe('non-developer');
    // Other keys must be preserved
    expect(config.someOtherKey).toBe('preserved');
  }, 10000);

  it('adds .env to .gitignore when .gitignore does not exist', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    const gitignorePath = join(projectRoot, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(false);

    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '', '', '', '', 'secret', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);
    expect(existsSync(gitignorePath)).toBe(true);
    expect(readFileSync(gitignorePath, 'utf-8')).toContain('.env');
  }, 10000);

  it('adds .env to .gitignore when .gitignore exists but does not list .env', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    const gitignorePath = join(projectRoot, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules/\ndist/\n', 'utf-8');

    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '', '', '', '', 'secret', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
    expect(gitignoreContent).toContain('.env');
    // Original content preserved
    expect(gitignoreContent).toContain('node_modules/');
  }, 10000);

  it('does not add duplicate .env entry when .gitignore already contains it', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    const gitignorePath = join(projectRoot, '.gitignore');
    writeFileSync(gitignorePath, 'node_modules/\n.env\ndist/\n', 'utf-8');

    await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '', '', '', '', 'secret', 'n'],
      { HOME: tmpHome },
    );

    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
    // .env should appear exactly once
    const matches = gitignoreContent.split('\n').filter(l => l.trim() === '.env');
    expect(matches.length).toBe(1);
  }, 10000);

  it('uses default values when user presses Enter for URI, database, username', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    // All Enter (empty) for everything except password
    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['', '', '', '', '', 'mypass', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);

    const envContent = readFileSync(join(projectRoot, '.env'), 'utf-8');
    expect(envContent).toContain('NEO4J_URI=bolt://localhost:7687');
    expect(envContent).toContain('NEO4J_DATABASE=neo4j');
    expect(envContent).toContain('NEO4J_USERNAME=neo4j');
    expect(envContent).toContain('NEO4J_CONNECTION_TYPE=driver');
    expect(envContent).toContain('NEO4J_PASSWORD=mypass');
  }, 10000);

  it('saves cypher-shell connection type when user selects option 2', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '2', '', '', '', 'pass', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(projectRoot, '.env'), 'utf-8')).toContain(
      'NEO4J_CONNECTION_TYPE=cypher-shell',
    );
  }, 10000);

  it('saves mcp connection type when user selects option 3', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    const result = await runWizard(
      wizardScriptPath,
      projectRoot,
      ['1', '3', '', '', '', 'pass', 'n'],
      { HOME: tmpHome },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(projectRoot, '.env'), 'utf-8')).toContain(
      'NEO4J_CONNECTION_TYPE=mcp',
    );
  }, 10000);
});

// ══════════════════════════════════════════════════════════════════════════════
// Area 3: Role reading — saveGlobalAppConfig and config.json round-trip
// ══════════════════════════════════════════════════════════════════════════════

describe('saveGlobalAppConfig (via wizard) — config.json round-trip', () => {
  let tmpHome;
  let projectRoot;
  let wizardScriptPath;

  beforeEach(() => {
    if (!WIZARD_SCRIPT_CONTENT) return;

    tmpHome = mkdtempSync(join(tmpdir(), 'role-home-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'role-project-'));

    const tmpDir = join(projectRoot, '.grasp-it', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    wizardScriptPath = join(tmpDir, 'first-use-setup.mjs');
    writeFileSync(wizardScriptPath, WIZARD_SCRIPT_CONTENT, 'utf-8');
  });

  afterEach(() => {
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('config.json written by wizard is valid JSON with a role field', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    await runWizard(wizardScriptPath, projectRoot, ['1', '', '', '', '', 'pass', 'n'], {
      HOME: tmpHome,
    });

    const configPath = join(tmpHome, '.grasp-it', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const rawContent = readFileSync(configPath, 'utf-8');
    expect(() => JSON.parse(rawContent)).not.toThrow();
    const parsed = JSON.parse(rawContent);
    expect(parsed).toHaveProperty('role');
    expect(['developer', 'non-developer']).toContain(parsed.role);
  }, 10000);

  it('config.json role can be read back by the bash snippet node inline eval', async () => {
    if (!WIZARD_SCRIPT_CONTENT) { expect(WIZARD_SCRIPT_CONTENT).not.toBeNull(); return; }

    await runWizard(wizardScriptPath, projectRoot, ['2', '', '', '', '', 'pass', 'n'], {
      HOME: tmpHome,
    });

    const configPath = join(tmpHome, '.grasp-it', 'config.json');

    // Replicate what the bash snippet does to read the role:
    // node -e "try{const c=JSON.parse(require('fs').readFileSync('<path>','utf-8'));process.stdout.write(c.role||'')}catch{}"
    const evalResult = spawnSync(
      'node',
      [
        '-e',
        `try{const c=JSON.parse(require('fs').readFileSync(${JSON.stringify(configPath)},'utf-8'));process.stdout.write(c.role||'')}catch{}`,
      ],
      { encoding: 'utf-8' },
    );

    expect(evalResult.status).toBe(0);
    expect(evalResult.stdout).toBe('non-developer');
  }, 10000);
});
