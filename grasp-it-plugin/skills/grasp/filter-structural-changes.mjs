#!/usr/bin/env node
/**
 * filter-structural-changes.mjs
 *
 * Filters changed files into STRUCTURAL (require LLM re-analysis) vs
 * COSMETIC-only (skip LLM re-analysis) using the fingerprint baseline.
 *
 * Runs after Phase 0 identifies changed files and before Phase 2 dispatches
 * file-analyzer agents. Skipping cosmetic-only files saves unnecessary LLM
 * calls for trivial changes (comment edits, whitespace, variable renames inside
 * function bodies).
 *
 * Usage:
 *   node filter-structural-changes.mjs <project-root>
 *
 * Reads:
 *   <project-root>/.grasp-it/tmp/changed-files.txt   — one file path per line
 *   <project-root>/.grasp-it/fingerprints.json       — baseline (optional)
 *
 * Writes:
 *   <project-root>/.grasp-it/tmp/structural-changed-files.txt
 *   <project-root>/.grasp-it/tmp/cosmetic-only-files.txt
 *
 * Exit code: 0 (always — cosmetic files are not errors)
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// skills/grasp/ -> plugin root is two dirs up
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

// ---------------------------------------------------------------------------
// Resolve @grasp-it/core (matches extract-structure.mjs / compute-batches.mjs).
// ---------------------------------------------------------------------------
let core;
try {
  core = await import(pathToFileURL(require.resolve('@grasp-it/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}

const {
  TreeSitterPlugin,
  PluginRegistry,
  builtinLanguageConfigs,
  registerAllParsers,
  analyzeChanges,
  loadFingerprints,
} = core;

async function main() {
  const [, , projectRoot] = process.argv;
  if (!projectRoot) {
    process.stderr.write('Usage: node filter-structural-changes.mjs <project-root>\n');
    process.exit(1);
  }

  const changedFilesPath = resolve(projectRoot, '.grasp-it', 'tmp', 'changed-files.txt');
  const structuralOutPath = resolve(projectRoot, '.grasp-it', 'tmp', 'structural-changed-files.txt');
  const cosmeticOutPath   = resolve(projectRoot, '.grasp-it', 'tmp', 'cosmetic-only-files.txt');

  // ── Read changed-files.txt ─────────────────────────────────────────────
  if (!existsSync(changedFilesPath)) {
    // No changed files — nothing to filter. Write empty outputs.
    writeOutput(structuralOutPath, []);
    writeOutput(cosmeticOutPath, []);
    process.stdout.write('No changed files found.\n');
    process.exit(0);
  }

  const changedFiles = readFileSync(changedFilesPath, 'utf-8')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    writeOutput(structuralOutPath, []);
    writeOutput(cosmeticOutPath, []);
    process.stdout.write('No changed files found.\n');
    process.exit(0);
  }

  // ── Load fingerprints (graceful fallback) ───────────────────────────────
  const existingStore = loadFingerprints(projectRoot);

  if (!existingStore) {
    // No baseline — treat all files as STRUCTURAL (conservative, previous behavior).
    // Write all to structural-changed-files.txt, cosmetic-only-files.txt stays empty.
    process.stderr.write(
      'Warning: fingerprints.json not found — treating all changed files as STRUCTURAL\n',
    );
    writeOutput(structuralOutPath, changedFiles);
    writeOutput(cosmeticOutPath, []);
    const count = changedFiles.length;
    process.stdout.write(`Fingerprints baseline missing — ${count} file(s) classified STRUCTURAL\n`);
    process.exit(0);
  }

  // ── Build the registry (same config as build-fingerprints.mjs) ────────────
  const tsConfigs = builtinLanguageConfigs.filter((c) => c.treeSitter);
  const tsPlugin = new TreeSitterPlugin(tsConfigs);
  await tsPlugin.init();

  const registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);

  // ── Classify each changed file ───────────────────────────────────────────
  const analysis = analyzeChanges(projectRoot, changedFiles, existingStore, registry);

  writeOutput(structuralOutPath, [
    ...analysis.newFiles,
    ...analysis.deletedFiles,
    ...analysis.structurallyChangedFiles,
  ]);
  writeOutput(cosmeticOutPath, [
    ...analysis.cosmeticOnlyFiles,
    ...analysis.unchangedFiles,
  ]);

  const structuralCount = analysis.structurallyChangedFiles.length
    + analysis.newFiles.length
    + analysis.deletedFiles.length;
  const cosmeticCount   = analysis.cosmeticOnlyFiles.length + analysis.unchangedFiles.length;

  process.stdout.write(
    `Classification: ${structuralCount} STRUCTURAL, ${cosmeticCount} COSMETIC/NONE — ` +
    `${changedFiles.length} total changed files\n`,
  );

  // Write detail lines for each cosmetic file (info, not warning — expected path)
  for (const f of analysis.cosmeticOnlyFiles) {
    process.stdout.write(`Info: ${f} — cosmetic-only change, LLM re-analysis skipped\n`);
  }
  for (const f of analysis.unchangedFiles) {
    process.stdout.write(`Info: ${f} — no content change detected\n`);
  }
}

/**
 * Write a list of file paths (one per line) to `outPath`.
 * Creates parent directory if needed.
 */
function writeOutput(outPath, files) {
  const dir = dirname(outPath);
  if (!existsSync(dir)) {
    // create directory synchronously — mkdirSync is safe here
    const { mkdirSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
  }
  const { writeFileSync } = require('node:fs');
  writeFileSync(outPath, files.join('\n') + '\n', 'utf-8');
}

await main();