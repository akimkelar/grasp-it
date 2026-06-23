import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../grasp-it-plugin/skills/grasp/extract-modules.mjs',
);

function runScript(projectRoot) {
  try {
    const stdout = execFileSync('node', [SCRIPT, projectRoot], {
      encoding: 'utf-8',
      cwd: projectRoot,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

function readModules(projectRoot) {
  const p = join(projectRoot, '.grasp-it', 'intermediate', 'modules.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function mkProject() {
  const root = mkdtempSync(join(tmpdir(), 'ua-extmod-test-'));
  mkdirSync(join(root, '.grasp-it', 'intermediate'), { recursive: true });
  return root;
}

function writeScanResult(root, scan) {
  writeFileSync(
    join(root, '.grasp-it', 'intermediate', 'scan-result.json'),
    JSON.stringify(scan),
  );
}

function writeFile(dir, content) {
  mkdirSync(dirname(dir), { recursive: true });
  writeFileSync(dir, content);
}

// Build a scan result. `entries` is an array of either strings (fileCategory=code)
// or { path, category } objects.
function minimalScan(entries) {
  const files = entries.map(e => {
    if (typeof e === 'string') {
      return { path: e, language: 'typescript', sizeLines: 10, fileCategory: 'code' };
    }
    return { path: e.path, language: 'typescript', sizeLines: 10, fileCategory: e.category };
  });
  return {
    name: 'test',
    description: '',
    languages: ['typescript'],
    frameworks: [],
    files,
    totalFiles: files.length,
    filteredByIgnore: 0,
    estimatedComplexity: 'small',
    importMap: {},
  };
}

function byId(modules, id) {
  return modules.find(m => m.id === id);
}

afterEach(() => {
  // cleanup happens via test-scope root tracking; nothing global needed here
});

describe('extract-modules.mjs — pnpm workspaces', () => {
  it('produces one module per workspace package', () => {
    const root = mkProject();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFile(join(root, 'packages/core/src/index.ts'), 'export const x = 1;\n');
    writeFile(join(root, 'packages/core/package.json'), '{"name":"@app/core"}\n');
    writeFile(join(root, 'packages/skill/src/index.ts'), 'export const y = 2;\n');
    writeFile(join(root, 'packages/skill/package.json'), '{"name":"@app/skill"}\n');
    writeScanResult(root, minimalScan([
      { path: 'packages/core/src/index.ts', category: 'code' },
      { path: 'packages/core/package.json', category: 'config' },
      { path: 'packages/skill/src/index.ts', category: 'code' },
      { path: 'packages/skill/package.json', category: 'config' },
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    expect(mods.length).toBe(2);

    const coreMod = byId(mods, 'module:packages/core');
    expect(coreMod).toBeDefined();
    expect(coreMod.name).toBe('packages/core');
    expect(coreMod.fileIds).toContain('file:packages/core/src/index.ts');
    expect(coreMod.fileIds).toContain('config:packages/core/package.json');

    const skillMod = byId(mods, 'module:packages/skill');
    expect(skillMod).toBeDefined();
    expect(skillMod.fileIds).toContain('file:packages/skill/src/index.ts');

    rmSync(root, { recursive: true, force: true });
  });

  it('handles glob like "apps/*" and "packages/*"', () => {
    const root = mkProject();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n');
    writeFile(join(root, 'apps/web/src/index.ts'), 'export const w = 1;\n');
    writeFile(join(root, 'packages/lib/src/index.ts'), 'export const l = 1;\n');
    writeScanResult(root, minimalScan([
      'apps/web/src/index.ts',
      'packages/lib/src/index.ts',
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);
    const mods = readModules(root).modules;
    expect(mods.length).toBe(2);
    expect(mods.some(m => m.id === 'module:apps/web')).toBe(true);
    expect(mods.some(m => m.id === 'module:packages/lib')).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('extract-modules.mjs — npm workspaces', () => {
  it('produces one module per workspace from package.json workspaces field', () => {
    const root = mkProject();
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'monorepo',
      workspaces: ['packages/*'],
    }));
    writeFile(join(root, 'packages/a/src/index.ts'), 'export const a = 1;\n');
    writeFile(join(root, 'packages/b/src/index.ts'), 'export const b = 1;\n');
    writeScanResult(root, minimalScan([
      'packages/a/src/index.ts',
      'packages/b/src/index.ts',
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    expect(mods.length).toBe(2);

    const aMod = byId(mods, 'module:packages/a');
    expect(aMod).toBeDefined();
    const bMod = byId(mods, 'module:packages/b');
    expect(bMod).toBeDefined();
    expect(aMod.fileIds).toContain('file:packages/a/src/index.ts');
    expect(bMod.fileIds).toContain('file:packages/b/src/index.ts');

    rmSync(root, { recursive: true, force: true });
  });
});

describe('extract-modules.mjs — lerna', () => {
  it('produces one module per lerna package', () => {
    const root = mkProject();
    writeFileSync(join(root, 'lerna.json'), JSON.stringify({
      version: '1.0.0',
      packages: ['packages/*'],
    }));
    writeFile(join(root, 'packages/pkg1/src/index.ts'), 'export const p1 = 1;\n');
    writeFile(join(root, 'packages/pkg2/src/index.ts'), 'export const p2 = 1;\n');
    writeScanResult(root, minimalScan([
      'packages/pkg1/src/index.ts',
      'packages/pkg2/src/index.ts',
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    expect(mods.length).toBe(2);
    expect(mods.some(m => m.id === 'module:packages/pkg1')).toBe(true);
    expect(mods.some(m => m.id === 'module:packages/pkg2')).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('extract-modules.mjs — tsconfig paths', () => {
  it('produces one module per top-level tsconfig paths mapping', () => {
    const root = mkProject();
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        paths: {
          '@app/*': ['src/*'],
          '@lib/*': ['lib/*'],
        },
      },
    }));
    writeFile(join(root, 'src/index.ts'), 'export const x = 1;\n');
    writeFile(join(root, 'lib/util.ts'), 'export const u = 1;\n');
    writeScanResult(root, minimalScan([
      'src/index.ts',
      'lib/util.ts',
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    expect(mods.length).toBe(2);

    const appMod = byId(mods, 'module:app');
    expect(appMod).toBeDefined();
    expect(appMod.fileIds).toContain('file:src/index.ts');

    const libMod = byId(mods, 'module:lib');
    expect(libMod).toBeDefined();
    expect(libMod.fileIds).toContain('file:lib/util.ts');

    rmSync(root, { recursive: true, force: true });
  });
});

describe('extract-modules.mjs — fallback (top-level dirs)', () => {
  it('produces modules from top-level code directories', () => {
    const root = mkProject();
    // No manifest files at all — fallback fires
    writeFile(join(root, 'src/a/index.ts'), 'export const a = 1;\n');
    writeFile(join(root, 'src/b/index.ts'), 'export const b = 1;\n');
    writeFile(join(root, 'pkg/c/index.ts'), 'export const c = 1;\n');
    writeFile(join(root, 'pkg/d/index.ts'), 'export const d = 1;\n');
    writeScanResult(root, minimalScan([
      'src/a/index.ts',
      'src/b/index.ts',
      'pkg/c/index.ts',
      'pkg/d/index.ts',
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    expect(mods.length).toBe(2); // src and pkg (both have 2 files)

    const srcMod = byId(mods, 'module:src');
    expect(srcMod).toBeDefined();
    expect(srcMod.fileIds).toContain('file:src/a/index.ts');
    expect(srcMod.fileIds).toContain('file:src/b/index.ts');

    const pkgMod = byId(mods, 'module:pkg');
    expect(pkgMod).toBeDefined();
    expect(pkgMod.fileIds).toContain('file:pkg/c/index.ts');
    expect(pkgMod.fileIds).toContain('file:pkg/d/index.ts');

    rmSync(root, { recursive: true, force: true });
  });

  it('single-package repo produces zero modules (the package itself is implicit)', () => {
    const root = mkProject();
    writeFile(join(root, 'src/index.ts'), 'export const x = 1;\n');
    writeScanResult(root, minimalScan(['src/index.ts']));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    // Only one top-level dir with 1 file → filtered out (< 2 files threshold)
    expect(mods.length).toBe(0);

    rmSync(root, { recursive: true, force: true });
  });

  it('skips node_modules, dist, __tests__ in fallback', () => {
    const root = mkProject();
    writeFile(join(root, 'src/index.ts'), 'export const x = 1;\n');
    writeFile(join(root, 'node_modules/lodash/index.js'), 'module.exports = {};\n');
    writeFile(join(root, 'dist/bundle.js'), '// minified\n');
    writeFile(join(root, '__tests__/a.test.ts'), 'test("a", () => {});\n');
    writeScanResult(root, minimalScan([
      'src/index.ts',
      'node_modules/lodash/index.js',
      'dist/bundle.js',
      '__tests__/a.test.ts',
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    // Only src with 1 file → filtered out (< 2)
    expect(mods.length).toBe(0);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('extract-modules.mjs — output schema', () => {
  it('module fileIds match the file list within that workspace', () => {
    const root = mkProject();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "pkgs/*"\n');
    writeFile(join(root, 'pkgs/core/src/a.ts'), 'export const a = 1;\n');
    writeFile(join(root, 'pkgs/core/src/b.ts'), 'export const b = 1;\n');
    writeFile(join(root, 'pkgs/core/package.json'), '{}');
    writeFile(join(root, 'pkgs/ui/src/c.ts'), 'export const c = 1;\n');
    writeScanResult(root, minimalScan([
      { path: 'pkgs/core/src/a.ts', category: 'code' },
      { path: 'pkgs/core/src/b.ts', category: 'code' },
      { path: 'pkgs/core/package.json', category: 'config' },
      { path: 'pkgs/ui/src/c.ts', category: 'code' },
    ]));

    const result = runScript(root);
    expect(result.status).toBe(0);

    const mods = readModules(root).modules;
    const coreMod = byId(mods, 'module:pkgs/core');
    expect(coreMod.fileIds).toContain('file:pkgs/core/src/a.ts');
    expect(coreMod.fileIds).toContain('file:pkgs/core/src/b.ts');
    expect(coreMod.fileIds).toContain('config:pkgs/core/package.json');
    expect(coreMod.fileIds).not.toContain('file:pkgs/ui/src/c.ts');

    rmSync(root, { recursive: true, force: true });
  });

  it('scriptCompleted is true on success', () => {
    const root = mkProject();
    writeScanResult(root, minimalScan(['src/index.ts']));

    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(readModules(root).scriptCompleted).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('fails with usage when projectRoot is missing', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage:/);
  });
});
