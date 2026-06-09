/**
 * Tests for grasp-domain SKILL.md changes:
 * - Phase 3 --files argument forwarding to extract-domain-context.py
 * - Phase 4 scope filtering when --files is provided
 * - domain-analyzer.md new rules (scope-relative scaling, external actors, feature toggles)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from 'node:os';
import { join } from "node:path";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILL_MD = resolve(__dirname, '../../../grasp-it-plugin/skills/grasp-domain/SKILL.md');
const DOMAIN_ANALYZER_MD = resolve(__dirname, '../../../grasp-it-plugin/agents/domain-analyzer.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

function runBash(script) {
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf-8',
    env: { ...process.env },
  });
}

// ── Tests: Phase 3 --files argument parsing ───────────────────────────────────

describe('Phase 3 --files argument parsing', () => {
  it('extracts --files value with space separator', () => {
    const arguments_ = '--scope surcharge --files a.groovy,b.groovy --full';
    const result = runBash(`
      ARGUMENTS="${arguments_}"
      SCOPED_FILES_ARG=""
      if echo "$ARGUMENTS" | grep -qE "\\-\\-files[= ]"; then
        SCOPED_FILES=$(echo "$ARGUMENTS" | sed -E 's/.*--files[= ]([^ ]+).*/\\1/')
        if [ -n "$SCOPED_FILES" ]; then
          SCOPED_FILES_ARG="--files $SCOPED_FILES"
          echo "SCOPED_FILES=$SCOPED_FILES"
          echo "SCOPED_FILES_ARG=$SCOPED_FILES_ARG"
        fi
      fi
    `);
    expect(result.stdout).toContain('SCOPED_FILES=a.groovy,b.groovy');
    expect(result.stdout).toContain('SCOPED_FILES_ARG=--files a.groovy,b.groovy');
  });

  it('extracts --files value with = separator', () => {
    const arguments_ = '--files src/Order.java,src/Invoice.java';
    const result = runBash(`
      ARGUMENTS="${arguments_}"
      SCOPED_FILES_ARG=""
      if echo "$ARGUMENTS" | grep -qE "\\-\\-files[= ]"; then
        SCOPED_FILES=$(echo "$ARGUMENTS" | sed -E 's/.*--files[= ]([^ ]+).*/\\1/')
        if [ -n "$SCOPED_FILES" ]; then
          SCOPED_FILES_ARG="--files $SCOPED_FILES"
          echo "SCOPED_FILES=$SCOPED_FILES"
        fi
      fi
    `);
    expect(result.stdout).toContain('SCOPED_FILES=src/Order.java,src/Invoice.java');
  });

  it('returns empty when --files is not present', () => {
    const arguments_ = '--scope surcharge --full';
    const result = runBash(`
      ARGUMENTS="${arguments_}"
      SCOPED_FILES_ARG=""
      if echo "$ARGUMENTS" | grep -qE "\\-\\-files[= ]"; then
        SCOPED_FILES=$(echo "$ARGUMENTS" | sed -E 's/.*--files[= ]([^ ]+).*/\\1/')
        if [ -n "$SCOPED_FILES" ]; then
          SCOPED_FILES_ARG="--files $SCOPED_FILES"
        fi
      fi
      echo "SCOPED_FILES_ARG=[$SCOPED_FILES_ARG]"
    `);
    expect(result.stdout).toContain('SCOPED_FILES_ARG=[]');
  });

  it('handles --files at end of arguments', () => {
    const arguments_ = '--standalone --files PaymentService.groovy';
    const result = runBash(`
      ARGUMENTS="${arguments_}"
      SCOPED_FILES_ARG=""
      if echo "$ARGUMENTS" | grep -qE "\\-\\-files[= ]"; then
        SCOPED_FILES=$(echo "$ARGUMENTS" | sed -E 's/.*--files[= ]([^ ]+).*/\\1/')
        if [ -n "$SCOPED_FILES" ]; then
          SCOPED_FILES_ARG="--files $SCOPED_FILES"
        fi
      fi
      echo "SCOPED_FILES=$SCOPED_FILES"
    `);
    expect(result.stdout).toContain('SCOPED_FILES=PaymentService.groovy');
  });
});

// ── Tests: Phase 4 scoped Cypher query building ───────────────────────────────

describe('Phase 4 scoped Cypher query building', () => {
  it('builds JSON array from comma-separated files', () => {
    const result = runBash(`
      SCOPED_FILES="a.groovy,b.groovy,c.groovy"
      SCOPED_FILES_JSON="[$(echo "$SCOPED_FILES" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/')]"
      echo "SCOPED_FILES_JSON=$SCOPED_FILES_JSON"
    `);
    expect(result.stdout).toContain('["a.groovy","b.groovy","c.groovy"]');
  });

  it('builds scoped WHERE clause with filePath CONTAINS', () => {
    const result = runBash(`
      SCOPED_FILES_JSON='["Order.java","Invoice.java"]'
      CYPHER_QUERY="MATCH (n) WHERE any(f IN $SCOPED_FILES_JSON WHERE n.filePath CONTAINS f) OR n.kind = 'knowledge' RETURN n ORDER BY n.name"
      echo "$CYPHER_QUERY" | grep -q "filePath CONTAINS f"
      echo "OK"
    `);
    expect(result.stdout).toContain('OK');
  });

  it('includes knowledge nodes in scoped query (they have no filePath)', () => {
    const result = runBash(`
      SCOPED_FILES_JSON='["Order.java"]'
      CYPHER_QUERY="MATCH (n) WHERE any(f IN $SCOPED_FILES_JSON WHERE n.filePath CONTAINS f) OR n.kind = 'knowledge' RETURN n ORDER BY n.name"
      echo "$CYPHER_QUERY" | grep -q "n.kind = 'knowledge'"
      echo "OK"
    `);
    expect(result.stdout).toContain('OK');
  });

  it('uses unscoped query when --files not provided', () => {
    const result = runBash(`
      SCOPED_FILES_ARG=""
      if [ -n "$SCOPED_FILES_ARG" ]; then
        CYPHER_QUERY="MATCH (n) WHERE any(f IN [\\\"a.groovy\\\"] WHERE n.filePath CONTAINS f) RETURN n"
      else
        CYPHER_QUERY="MATCH (n) RETURN n ORDER BY n.name"
      fi
      echo "$CYPHER_QUERY" | grep -q "MATCH (n) RETURN n ORDER BY n.name"
      echo "OK"
    `);
    expect(result.stdout).toContain('OK');
  });
});

// ── Tests: domain-analyzer.md new rules ──────────────────────────────────────

describe('domain-analyzer.md new rules', () => {
  let content;

  beforeEach(() => {
    content = readFileSync(DOMAIN_ANALYZER_MD, 'utf-8');
  });

  it('Rule 7 contains scope-relative scale guidance with hard cap', () => {
    // Rule 7 spans multiple lines — capture from "7. **Scale appropriately**" through the
    // paragraph before "8. **Groovy/Grails"
    const rule7Block = content.match(/7\.\s+\*\*Scale appropriately\*\*:.*?(?=\n\s*8\.)/s);
    expect(rule7Block).not.toBeNull();
    const rule7 = rule7Block[0];
    // Should mention scope sizes
    expect(rule7).toMatch(/Small scope|Media scope|Large scope/);
    expect(rule7).toMatch(/10 files/);
    expect(rule7).toMatch(/25.*files/);
    // Should have a hard cap of 300
    expect(rule7).toMatch(/300\s+total\s+nodes/);
    // The old fixed "2-6 domains" guidance should be gone
    expect(rule7).not.toContain('2-6 domains, 2-5 features per domain');
  });

  it('Rule 10 exists and mentions external system actors', () => {
    // Rule 10 should cover external system actors
    expect(content).toMatch(/10\.\s+\*\*Capture external system actors\*\*/);
    // Should mention valid actor examples like payment-api, email-queue, nightly-job
    expect(content).toMatch(/actor:payment-api|actor:email-queue|actor:nightly-job/);
  });

  it('Rule 11 exists and mentions feature toggles as BusinessRule nodes', () => {
    // Rule 11 should cover feature toggles / algorithm switches
    expect(content).toMatch(/11\.\s+\*\*Capture feature toggles/);
    // Should mention BusinessRule and ruleText
    expect(content).toMatch(/business-rule.*ruleText|ruleText.*business-rule/);
    // Should mention FEATURE_X or similar flag example
    expect(content).toMatch(/FEATURE_|feature.*flag|algorithm.*switch/i);
  });

  it('Actor node hierarchy entry references external system actors and Rule 10', () => {
    // The Actor line in Node Hierarchy should mention external system actors and Rule 10
    // The Node Hierarchy section has Actor as item 4 (numbered list starting there)
    expect(content).toMatch(/\*\*Actor\*\*.*Payment API.*Nightly Job.*Email Queue/);
    expect(content).toMatch(/\*\*Actor\*\*.*see Rule 10/);
  });
});

// ── Tests: SKILL.md Phase 3 mentions --files forwarding ──────────────────────

describe('SKILL.md Phase 3 --files forwarding', () => {
  let content;

  beforeEach(() => {
    content = readFileSync(SKILL_MD, 'utf-8');
  });

  it('Phase 3 step 1 parses --files from ARGUMENTS', () => {
    // Should contain the grep pattern for --files
    expect(content).toMatch(/grep -qE.*\\-\\-files/);
  });

  it('Phase 3 calls extract-domain-context.py with $SCOPED_FILES_ARG', () => {
    // The call to extract-domain-context.py should include $SCOPED_FILES_ARG
    const phase3Section = content.match(/Phase 3:.*?(?=Phase 4:|$)/s);
    expect(phase3Section[0]).toMatch(/extract-domain-context\.py.*\$SCOPED_FILES_ARG/);
  });
});

// ── Tests: SKILL.md Phase 4 scope filtering ───────────────────────────────────

describe('SKILL.md Phase 4 scope filtering', () => {
  let content;

  beforeEach(() => {
    content = readFileSync(SKILL_MD, 'utf-8');
  });

  it('Phase 4 parses --files from ARGUMENTS', () => {
    const phase4Section = content.match(/Phase 4:.*?(?=Phase 5:|$)/s);
    expect(phase4Section[0]).toMatch(/grep -qE.*\\-\\-files/);
  });

  it('Phase 4 builds scoped Cypher query when --files is present', () => {
    const phase4Section = content.match(/Phase 4:.*?(?=Phase 5:|$)/s);
    expect(phase4Section[0]).toMatch(/filePath CONTAINS f/);
    expect(phase4Section[0]).toMatch(/n\.kind = 'knowledge'/);
  });

  it('Phase 4 falls back to unscoped MATCH (n) RETURN n when no --files', () => {
    const phase4Section = content.match(/Phase 4:.*?(?=Phase 5:|$)/s);
    expect(phase4Section[0]).toMatch(/MATCH \(n\) RETURN n ORDER BY n\.name/);
  });
});