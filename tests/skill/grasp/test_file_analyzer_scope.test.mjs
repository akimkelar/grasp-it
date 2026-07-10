/**
 * Documentation invariant tests for the file-analyzer agent's scope restriction.
 *
 * Bug BUG-03: The LLM was paraphrasing the file-analyzer agent definition and
 * dropping the scope restriction that forbids `module:` and `concept:` node
 * types. These tests lock down the exact wording in `agents/file-analyzer.md`
 * so any future rewrite that weakens or removes the constraint is caught.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE_ANALYZER_MD = resolve(
  __dirname,
  '../../../grasp-it-plugin/agents/file-analyzer.md',
);

const fileContent = readFileSync(FILE_ANALYZER_MD, 'utf-8');
const lines = fileContent.split('\n');

function extractTableBlock(startLine, endLine) {
  return lines.slice(startLine - 1, endLine).join('\n');
}

describe('BUG-03 regression: file-analyzer.md scope restriction', () => {
  it('contains a scope restriction line that forbids module: and concept: with MUST NOT', () => {
    const scopeLines = lines.filter((line) => /scope restriction/i.test(line));
    expect(scopeLines.length).toBeGreaterThan(0);

    const scopeLineIdx = lines.findIndex((line) => /scope restriction/i.test(line));
    const contextWindow = lines
      .slice(scopeLineIdx, scopeLineIdx + 3)
      .join('\n');

    expect(contextWindow).toMatch(/module:/);
    expect(contextWindow).toMatch(/concept:/);
    expect(contextWindow).toMatch(/MUST NOT/i);
  });
});

describe('BUG-03 regression: forbidden node types in file-analyzer.md', () => {
  it('explicitly forbids concept: node types as reserved for higher-level analysis', () => {
    const conceptIdx = fileContent.indexOf('concept:');
    expect(conceptIdx).toBeGreaterThan(-1);

    const slice = fileContent.slice(conceptIdx, conceptIdx + 300);
    expect(slice).toMatch(/reserved for higher-level/i);
    expect(slice).toMatch(/MUST NOT/i);
  });

  it('explicitly forbids module: node types as reserved for higher-level analysis', () => {
    const moduleIdx = fileContent.indexOf('module:');
    expect(moduleIdx).toBeGreaterThan(-1);

    const slice = fileContent.slice(moduleIdx, moduleIdx + 300);
    expect(slice).toMatch(/reserved for higher-level/i);
    expect(slice).toMatch(/MUST NOT/i);
  });
});

describe('BUG-03 regression: file-analyzer.md node types table excludes reserved types', () => {
  it('node types table does NOT include concept or module (reserved for higher-level analysis)', () => {
    // The "Node Types and ID Conventions" table itself spans lines 297-309:
    // header row, separator, and 11 type rows. Excluding the scope restriction
    // line (311) is important — it legitimately mentions module:/concept:.
    const tableBlock = extractTableBlock(297, 310);

    // Standard types must be present so the test fails if the table is gutted.
    const expectedTypes = [
      'file:',
      'function:',
      'class:',
      'config:',
      'document:',
      'service:',
      'table:',
      'endpoint:',
      'pipeline:',
      'schema:',
      'resource:',
    ];
    for (const t of expectedTypes) {
      expect(tableBlock, `node types table should list ${t}`).toContain(t);
    }

    // concept and module must NOT appear inside the table block.
    const tableLower = tableBlock.toLowerCase();
    expect(tableLower, 'node types table must not contain "concept"').not.toMatch(/\bconcept\b/);
    expect(tableLower, 'node types table must not contain "module"').not.toMatch(/\bmodule\b/);
  });
});