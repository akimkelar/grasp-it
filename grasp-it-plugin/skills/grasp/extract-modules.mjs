#!/usr/bin/env node
/**
 * extract-modules.mjs — Phase 1.6 of /grasp
 *
 * Deterministic module extraction from workspace manifests and directory structure.
 * Reads scan-result.json and emits modules.json for injection into the graph.
 *
 * Module sources (in priority order):
 *   1. pnpm-workspace.yaml  packages[] globs
 *   2. package.json         workspaces field
 *   3. lerna.json            packages[]
 *   4. tsconfig.json         paths (top-level path mappings)
 *   5. Fallback: top-level code directories
 *
 * Usage:
 *   node extract-modules.mjs <project-root>
 *
 * Input:  <project-root>/.grasp-it/intermediate/scan-result.json
 * Output: <project-root>/.grasp-it/intermediate/modules.json
 */

import { readFileSync, existsSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { nodeTypeForFile } from './extract-structure.mjs';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '../..');
const require = createRequire(resolve(PLUGIN_ROOT, 'package.json'));

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/**
 * Split a path into directory (everything before the last segment) and
 * basename (the last segment).
 */
function pathDirBase(filePath) {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash < 0) return { dir: '', base: filePath };
  return { dir: filePath.slice(0, lastSlash), base: filePath.slice(lastSlash + 1) };
}

/**
 * Extract top-level directory from a path (everything before the first `/`).
 * Returns '' for paths at repo root.
 */
function topDir(filePath) {
  const firstSlash = filePath.indexOf('/');
  return firstSlash < 0 ? '' : filePath.slice(0, firstSlash);
}

/**
 * Check if `dir` is a subdirectory of a glob pattern root.
 * e.g. matchesModule('packages/core/src', ['packages/*']) → 'packages/core'
 *
 * A glob like `packages/*` matches:
 *   - `packages/core` (the module root itself, via wildcard)
 *   - `packages/core/src` (a subdirectory of the module)
 */
function matchesModuleGlob(dir, globs) {
  for (const glob of globs) {
    const segments = glob.split('/');
    // Find how many leading non-wildcard segments the glob has
    let prefixLen = 0;
    while (prefixLen < segments.length && !segments[prefixLen].includes('*')) {
      prefixLen++;
    }
    // The prefix is the fixed part of the glob
    const prefix = segments.slice(0, prefixLen).join('/');
    // The remaining glob segments (after the fixed prefix)
    const globRemaining = segments.slice(prefixLen);

    // Check if dir starts with the glob prefix (exact or as a subdirectory)
    if (!dir.startsWith(prefix)) continue;

    // What's left of the dir after the prefix?
    const remainder = dir.slice(prefix.length);
    const remainderSegs = remainder.split('/').filter(Boolean);

    // Case: glob ends with a fixed segment (no wildcard at end)
    // e.g. glob="packages" → prefix="packages", globRemaining=[]
    if (globRemaining.length === 0) {
      // Either dir exactly equals prefix, or dir is a subdirectory of prefix
      if (remainder === '' || remainder.startsWith('/')) {
        return dir;
      }
      continue;
    }

    // globRemaining[0] is the first wildcard-bearing segment
    const firstGlobSeg = globRemaining[0];

    if (firstGlobSeg === '**') {
      // ** matches any depth — dir is a submodule of the glob root
      return dir;
    }

    if (firstGlobSeg === '*') {
      // * matches exactly one non-empty segment
      if (remainderSegs.length >= 1) {
        return prefix + '/' + remainderSegs[0];
      }
      // remainderSegs.length === 0: dir exactly equals prefix.
      // The wildcard matches the directory itself (e.g. packages/* matches packages/core).
      // The module root is prefix/<the single segment that * would match>.
      // We need to figure out what that segment is from the original glob.
      // e.g. glob=packages/* → the * would match "core" (the first path component after prefix).
      // But we don't know what "core" is from dir alone.
      // Instead, for the case where dir === prefix, return null — the wildcard
      // matches a subdirectory, not the prefix itself.
      if (remainderSegs.length === 0) {
        // dir equals prefix exactly. The wildcard can't match "nothing".
        // Skip this glob; the file's subdirectories will match in other iterations.
        continue;
      }
    } else if (firstGlobSeg.includes('*') || firstGlobSeg.includes('?')) {
      // Wildcard in a single segment
      const re = new RegExp(
        '^' +
          firstGlobSeg.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') +
          '$'
      );
      if (remainderSegs.length >= 1 && re.test(remainderSegs[0])) {
        return prefix + '/' + remainderSegs[0];
      }
    } else {
      // Fixed segment — remainder must start with this segment
      if (remainderSegs.length >= 1 && remainderSegs[0] === firstGlobSeg) {
        if (globRemaining.length === 1) {
          return dir;
        }
      }
    }
  }
  return null;
}

/**
 * Group files by their top-level directory.
 * Returns Map<dirName, filePaths[]>
 */
function groupByTopDir(files) {
  const groups = new Map();
  for (const f of files) {
    const td = topDir(f.path);
    if (!groups.has(td)) groups.set(td, []);
    groups.get(td).push(f);
  }
  return groups;
}

/**
 * For a given set of workspace globs and file list, determine which top-level
 * directories are "module roots" (matched by a glob).
 * Returns a Set of directory paths that are module roots.
 */
function findModuleRoots(globs, files) {
  const roots = new Set();
  for (const f of files) {
    const { dir } = pathDirBase(f.path);
    const moduleRoot = matchesModuleGlob(dir, globs);
    if (moduleRoot) roots.add(moduleRoot);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Module source detectors (priority order)
// ---------------------------------------------------------------------------

/**
 * Parse pnpm-workspace.yaml packages globs.
 * Returns Array<{ id, name, summary, fileIds }> or null if not applicable.
 */
function extractPnpmModules(projectRoot, scanResult) {
  const wsPath = join(projectRoot, 'pnpm-workspace.yaml');
  if (!existsSync(wsPath)) return null;

  let globs;
  try {
    const content = readFileSync(wsPath, 'utf-8');
    // Minimal YAML parse: find "packages:" block then collect array items.
    const match = content.match(/^packages:\s*\n((?:\s*-\s*[^\n]+\n)*)/m);
    if (!match) return null;
    globs = match[1]
      .split('\n')
      .map(l => l.match(/^\s*-\s*(.+)/)?.[1])
      .filter(Boolean)
      .map(g => g.replace(/^['"]|['"]$/g, '').trim()); // strip quotes
  } catch {
    return null;
  }

  if (!globs || globs.length === 0) return null;

  const files = scanResult.files || [];
  const moduleRoots = findModuleRoots(globs, files);

  if (moduleRoots.size === 0) return null;

  // Group files by their module root
  const modules = [];
  for (const root of [...moduleRoots].sort()) {
    const moduleFiles = files.filter(f => {
      const { dir } = pathDirBase(f.path);
      return dir === root || dir.startsWith(root + '/');
    });

    modules.push({
      id: `module:${root}`,
      name: root,
      summary: `Module: ${root}`,
      fileIds: moduleFiles.map(f => `${nodeTypeForFile(f)}:${f.path}`),
    });
  }
  return modules;
}

/**
 * Parse package.json workspaces field.
 * Returns Array<{ id, name, summary, fileIds }> or null if not applicable.
 */
function extractNpmModules(projectRoot, scanResult) {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;

  let globs;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (!pkg.workspaces) return null;
    globs = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
    if (!Array.isArray(globs) || globs.length === 0) return null;
    globs = globs.map(g => g.replace(/^['"]|['"]$/g, '').trim()); // strip quotes if present
  } catch {
    return null;
  }

  const files = scanResult.files || [];
  const moduleRoots = findModuleRoots(globs, files);

  if (moduleRoots.size === 0) return null;

  const modules = [];
  for (const root of [...moduleRoots].sort()) {
    const moduleFiles = files.filter(f => {
      const { dir } = pathDirBase(f.path);
      return dir === root || dir.startsWith(root + '/');
    });

    modules.push({
      id: `module:${root}`,
      name: root,
      summary: `Module: ${root}`,
      fileIds: moduleFiles.map(f => `${nodeTypeForFile(f)}:${f.path}`),
    });
  }
  return modules;
}

/**
 * Parse lerna.json packages[].
 * Returns Array<{ id, name, summary, fileIds }> or null if not applicable.
 */
function extractLernaModules(projectRoot, scanResult) {
  const lernaPath = join(projectRoot, 'lerna.json');
  if (!existsSync(lernaPath)) return null;

  let packages;
  try {
    const lerna = JSON.parse(readFileSync(lernaPath, 'utf-8'));
    if (!Array.isArray(lerna.packages) || lerna.packages.length === 0) return null;
    packages = lerna.packages;
  } catch {
    return null;
  }

  const files = scanResult.files || [];
  const moduleRoots = findModuleRoots(packages, files);

  if (moduleRoots.size === 0) return null;

  const modules = [];
  for (const root of [...moduleRoots].sort()) {
    const moduleFiles = files.filter(f => {
      const { dir } = pathDirBase(f.path);
      return dir === root || dir.startsWith(root + '/');
    });

    modules.push({
      id: `module:${root}`,
      name: root,
      summary: `Module: ${root}`,
      fileIds: moduleFiles.map(f => `${nodeTypeForFile(f)}:${f.path}`),
    });
  }
  return modules;
}

/**
 * Parse tsconfig.json paths top-level mappings.
 * Each top-level path key (e.g. "@app/*") becomes a module.
 * Returns Array<{ id, name, summary, fileIds }> or null if not applicable.
 */
function extractTsconfigModules(projectRoot, scanResult) {
  const tsPath = join(projectRoot, 'tsconfig.json');
  if (!existsSync(tsPath)) return null;

  let paths;
  try {
    const ts = JSON.parse(readFileSync(tsPath, 'utf-8'));
    if (!ts.compilerOptions || !ts.compilerOptions.paths) return null;
    paths = ts.compilerOptions.paths;
  } catch {
    return null;
  }

  const modules = [];
  const files = scanResult.files || [];

  for (const [alias, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const moduleName = alias.replace(/\/\*$/, '').replace(/^@/, '');
    if (!moduleName) continue;

    // Build glob from the first target (e.g. "src/*" from "@app/*")
    const glob = targets[0].replace(/\/\*$/, '');

    // Find files that are under this glob root
    const moduleFiles = files.filter(f => {
      const { dir } = pathDirBase(f.path);
      // Check if dir starts with glob or equals glob
      return dir === glob || dir.startsWith(glob + '/');
    });

    if (moduleFiles.length === 0) continue;

    modules.push({
      id: `module:${moduleName}`,
      name: moduleName,
      summary: `Module: ${moduleName}`,
      fileIds: moduleFiles.map(f => `${nodeTypeForFile(f)}:${f.path}`),
    });
  }
  return modules.length > 0 ? modules : null;
}

/**
 * Fallback: top-level code directories.
 * Groups files under top-level directories that contain code files,
 * skipping node_modules, dist, __tests__, etc.
 */
function extractFallbackModules(projectRoot, scanResult) {
  const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'coverage', '__tests__', 'test', 'tests',
    'fixtures', 'testdata', 'docs', 'examples', 'scripts', 'migrations',
    '.git', '.github', '.circleci', '.gitlab-ci', '.idea', '.vscode',
    'vendor', 'venv', '.venv', '__pycache__', '.next', '.cache', '.turbo',
    'target', 'obj', 'out',
  ]);

  const files = scanResult.files || [];
  const codeFiles = files.filter(f => f.fileCategory === 'code');
  if (codeFiles.length === 0) return [];

  // Group by top-level directory
  const byTopDir = new Map();
  for (const f of codeFiles) {
    const td = topDir(f.path);
    if (td && !SKIP_DIRS.has(td)) {
      if (!byTopDir.has(td)) byTopDir.set(td, []);
      byTopDir.get(td).push(f);
    }
  }

  // Only include dirs that have 2+ files (single file dirs are not meaningful modules)
  const modules = [];
  for (const [dir, dirFiles] of byTopDir) {
    if (dirFiles.length < 2) continue;
    modules.push({
      id: `module:${dir}`,
      name: dir,
      summary: `Module: ${dir}`,
      fileIds: dirFiles.map(f => `${nodeTypeForFile(f)}:${f.path}`),
    });
  }
  return modules;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , projectRoot] = process.argv;
  if (!projectRoot) {
    process.stderr.write('Usage: node extract-modules.mjs <project-root>\n');
    process.exit(1);
  }

  const scanPath = join(projectRoot, '.grasp-it', 'intermediate', 'scan-result.json');
  if (!existsSync(scanPath)) {
    process.stderr.write(`extract-modules.mjs: scan-result.json not found at ${scanPath}\n`);
    process.exit(1);
  }

  let scanResult;
  try {
    scanResult = JSON.parse(readFileSync(scanPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`extract-modules.mjs: failed to parse scan-result.json: ${err.message}\n`);
    process.exit(1);
  }

  let modules = null;

  // Priority order: pnpm → npm workspaces → lerna → tsconfig paths → fallback
  modules = extractPnpmModules(projectRoot, scanResult);
  if (!modules) modules = extractNpmModules(projectRoot, scanResult);
  if (!modules) modules = extractLernaModules(projectRoot, scanResult);
  if (!modules) modules = extractTsconfigModules(projectRoot, scanResult);
  if (!modules) modules = extractFallbackModules(projectRoot, scanResult);

  // Deduplicate by id
  const seen = new Set();
  const unique = [];
  for (const m of modules || []) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      unique.push(m);
    }
  }

  const output = {
    scriptCompleted: true,
    modules: unique,
  };

  const outPath = join(projectRoot, '.grasp-it', 'intermediate', 'modules.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  process.stderr.write(
    `extract-modules: ${unique.length} module(s) written to ${outPath}\n`,
  );
}

function isCliEntry() {
  // Returns true only when this file is the direct CLI entry point.
  // When imported as a module (e.g. in tests), main() is NOT called.
  if (!process.argv[1]) return false;
  try {
    // The script file must exist and be executable (or readable by node).
    // Use pathToFileURL for proper URL form on Windows.
    const scriptPath = process.argv[1].replace(/\\/g, '/');
    const thisPath = pathToFileURL(process.argv[1]).href.replace(/\\/g, '/');
    const thisFileUrl = import.meta.url.replace(/\\/g, '/');
    return thisFileUrl === thisPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`extract-modules.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

export {
  matchesModuleGlob,
  topDir,
  pathDirBase,
  findModuleRoots,
  extractPnpmModules,
  extractNpmModules,
  extractLernaModules,
  extractTsconfigModules,
  extractFallbackModules,
};
