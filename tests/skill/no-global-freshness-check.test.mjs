/**
 * Regression test: the misleading global freshness check pattern
 * (Project.gitCommitHash vs git rev-parse HEAD) has been removed from
 * skill SKILL.md files where it added no value.
 *
 * Background:
 * The pattern produced false positives on branches, did not account for
 * per-domain staleness, and added a Neo4j round-trip on every skill
 * invocation. It was removed as Phase 1 of the freshness refactor.
 *
 * Task F (2026-06-26) further migrated the four Project-singleton
 * metadata fields off the singleton entirely:
 *   - gitCommitHash  → max(File.analyzedAtCommit) (Cypher aggregate)
 *   - lastAnalyzedAt → max(File.analyzedAt)       (Cypher aggregate)
 *   - version        → .grasp-it/config.json
 *   - analyzedFiles  → count(:File)               (Cypher aggregate)
 *   - domainCommit / domainAnalyzedAt → per-Domain analyzedAtCommit
 *
 * This test asserts:
 *  1. The original "Project.gitCommitHash" freshness pattern does NOT
 *     appear in any skill SKILL.md (Phase 1 + Task F removed it from
 *     /grasp too — the new pattern queries File aggregates).
 *  2. /grasp-domain uses the per-Domain aggregate (not Project.domainCommit).
 *  3. /grasp uses the File aggregation pattern (max(File.analyzedAtCommit)).
 *  4. None of the seven files compares to `git rev-parse HEAD` for
 *     freshness purposes. /grasp-diff may still reference it for
 *     legitimate diff/base-resolution logic, but not for freshness.
 *     /grasp-freshness uses it to feed the staleness query, not as a
 *     freshness warning, so a targeted assertion documents the exception.
 *  5. No removed phase still references `$LAST_COMMIT` outside /grasp-domain
 *     (where it remains the baseline for the per-Domain staleness check).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SKILL_DIR = join(REPO_ROOT, 'grasp-it-plugin', 'skills');

const FRESHNESS_PATTERN = "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash";

// Task F replacement pattern: /grasp derives `lastCommitHash` from File aggregation
const FILE_AGG_PATTERN = "MATCH (f:File) WHERE f.analyzedAtCommit IS NOT NULL RETURN max(f.analyzedAtCommit) AS gitCommitHash";

const SKILLS_WITHOUT_GLOBAL_CHECK = [
  'grasp-search',
  'grasp-chat',
  'grasp-gaps',
  'grasp-knowledge',
  'grasp-diff',
  'grasp-domain',
  'grasp-freshness',
];

function readSkill(skillName) {
  return readFileSync(join(SKILL_DIR, skillName, 'SKILL.md'), 'utf8');
}

describe('global freshness check removal', () => {
  for (const skillName of SKILLS_WITHOUT_GLOBAL_CHECK) {
    it(`${skillName}/SKILL.md no longer contains the global freshness check pattern`, () => {
      const content = readSkill(skillName);
      expect(content).not.toContain(FRESHNESS_PATTERN);
    });

    it(`${skillName}/SKILL.md no longer compares to 'git rev-parse HEAD' for freshness`, () => {
      const content = readSkill(skillName);
      // The pattern appears in skill docs only when comparing the Project.gitCommitHash
      // to HEAD as a freshness warning. Acceptable uses elsewhere (e.g. /grasp-diff
      // for diff base resolution, /grasp-knowledge for writing meta.json) are out of
      // scope — only freshness-comparison lines should be flagged.
      const lines = content.split('\n');
      const offending = lines.filter((line) =>
        line.includes('git rev-parse HEAD')
        && /stale|freshness|behind|analyzed at/i.test(line),
      );
      expect(offending).toEqual([]);
    });
  }

  it('grasp-domain/SKILL.md uses per-Domain analyzedAtCommit (Task F: replaces Project.domainCommit)', () => {
    const content = readSkill('grasp-domain');
    // Phase 2 staleness check should query Domain nodes, not the Project singleton
    expect(content).toContain('MATCH (d:Domain)');
    expect(content).not.toContain("MATCH (p:Project {id: 'project:singleton'}) RETURN p.domainCommit AS domainCommit");
    expect(content).not.toContain("SET p.domainAnalyzedAt");
  });

  it('grasp-domain/SKILL.md derives gitCommitHash via max(File.analyzedAtCommit) (Task F)', () => {
    const content = readSkill('grasp-domain');
    expect(content).toContain('max(f.analyzedAtCommit)');
  });

  it('skills that referenced $LAST_COMMIT for freshness no longer have the freshness phase', () => {
    // $LAST_COMMIT may legitimately appear in grasp-domain (it is the baseline
    // for the per-Domain staleness comparison). All other skills in scope should
    // no longer set or reference it as a freshness signal.
    const skillsThatMustNotSetLastCommit = [
      'grasp-search',
      'grasp-chat',
      'grasp-gaps',
      'grasp-knowledge',
      'grasp-diff',
    ];
    for (const skillName of skillsThatMustNotSetLastCommit) {
      const content = readSkill(skillName);
      expect(content).not.toMatch(/^LAST_COMMIT=/m);
      expect(content).not.toContain('$LAST_COMMIT');
    }
  });

  it('grasp/SKILL.md uses File-aggregate pattern (max(File.analyzedAtCommit)) for incremental-update freshness', () => {
    const content = readSkill('grasp');
    // Task F: /grasp's legitimate incremental-update detection now derives
    // lastCommitHash from the File aggregation, not the Project singleton.
    expect(content).toContain(FILE_AGG_PATTERN);
    expect(content).not.toContain(FRESHNESS_PATTERN);
  });

  it('grasp-search/SKILL.md no longer has the Phase 0 Graph Freshness Check heading', () => {
    const content = readSkill('grasp-search');
    expect(content).not.toMatch(/Phase 0:\s*Graph Freshness Check/);
  });

  it('grasp-diff/SKILL.md no longer has the Phase 1 Graph Freshness Check heading', () => {
    const content = readSkill('grasp-diff');
    expect(content).not.toMatch(/Phase 1:\s*Graph Freshness Check/);
  });

  it('grasp-freshness/SKILL.md uses git rev-parse HEAD to feed $currentCommit (not as a freshness warning)', () => {
    // /grasp-freshness legitimately references git rev-parse HEAD in Phase 1
    // to populate the $currentCommit parameter for the staleness query. This
    // is the input to a per-domain report, not a HEAD-vs-stored-commit
    // freshness comparison. The general "no git rev-parse HEAD for freshness"
    // check above would over-flag it — document the legitimate use here.
    const content = readSkill('grasp-freshness');
    expect(content).toContain('rev-parse HEAD');
    // And confirm the result is consumed by the staleness query, not compared
    // against a stored gitCommitHash.
    expect(content).toContain('$currentCommit');
    expect(content).not.toContain(FRESHNESS_PATTERN);
  });
});
