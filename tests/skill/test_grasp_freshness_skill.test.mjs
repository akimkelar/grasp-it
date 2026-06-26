/**
 * Tests for the /grasp-freshness skill SKILL.md.
 *
 * Asserts the skill:
 *   1. Contains the right phase headers (Phase 0..6 / 0..7).
 *   2. Uses buildStaleImplementedByCypher from @grasp-it/core (the new core API).
 *   3. Calls `git rev-parse HEAD` to get the current commit.
 *   4. Groups stale nodes by Domain via HAS_FEATURE / HAS_OPERATION traversal.
 *   5. Falls back to sourceFiles directory for nodes without a Domain.
 *   6. Ranks groups by stale count DESC, oldest commit ASC.
 *   7. Does NOT auto-refresh (no /grasp or /grasp --full call without user action).
 *   8. Does NOT contain the global freshness check pattern (Project.gitCommitHash
 *      vs git rev-parse HEAD as a freshness warning).
 *   9. Passes the params bag through run-query.mjs (uses $currentCommit placeholder).
 *  10. Recommends /grasp-domain or /grasp --full to the user.
 *
 * These are structural / content tests on the SKILL.md file, not integration
 * tests against a live Neo4j instance. The intent is to lock the contract so
 * refactors that break the documented behavior fail loudly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SKILL_PATH = join(REPO_ROOT, 'grasp-it-plugin', 'skills', 'grasp-freshness', 'SKILL.md');

const SKILL_CONTENT = readFileSync(SKILL_PATH, 'utf-8');

const FRESHNESS_PATTERN = "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash";

describe('/grasp-freshness skill — SKILL.md contract', () => {
  describe('frontmatter', () => {
    it('declares name: grasp-freshness', () => {
      expect(SKILL_CONTENT).toMatch(/^name:\s*grasp-freshness\s*$/m);
    });

    it('declares a description suitable for the frontmatter', () => {
      // The description should mention "stale" or "freshness" so the skill
      // surfaces in autocomplete for users asking about graph staleness.
      const m = SKILL_CONTENT.match(/^description:\s*(.+)$/m);
      expect(m).not.toBeNull();
      expect(m[1].toLowerCase()).toMatch(/stale|freshness/);
    });
  });

  describe('phase structure', () => {
    it('has a Phase 0 (Setup) section', () => {
      expect(SKILL_CONTENT).toMatch(/###\s*Phase 0:/);
    });

    it('has a Phase 1 for getting the current HEAD commit', () => {
      expect(SKILL_CONTENT).toMatch(/###\s*Phase 1:[\s\S]*?HEAD/);
    });

    it('has a Phase 2 for querying stale IMPLEMENTED_BY edges', () => {
      expect(SKILL_CONTENT).toMatch(/###\s*Phase 2:[\s\S]*?IMPLEMENTED_BY/);
    });

    it('has a Phase 3 for grouping by Domain', () => {
      expect(SKILL_CONTENT).toMatch(/###\s*Phase 3:[\s\S]*?Domain/);
    });

    it('has a Phase 4 for sourceFiles fallback grouping', () => {
      // The fallback phase uses either "Fallback" or "sourceFiles" in its
      // heading — both are acceptable; assert at least one.
      const phase4 = SKILL_CONTENT.match(/###\s*Phase 4:[\s\S]*?(?=###\s*Phase 5:)/);
      expect(phase4).not.toBeNull();
      expect(phase4[0]).toMatch(/Fallback|sourceFiles/i);
    });

    it('has a Phase 5 for ranking', () => {
      expect(SKILL_CONTENT).toMatch(/###\s*Phase 5:[\s\S]*?[Rr]ank/);
    });

    it('has a Phase 6 for the report output', () => {
      expect(SKILL_CONTENT).toMatch(/###\s*Phase 6:[\s\S]*?[Rr]eport/);
    });
  });

  describe('core API usage', () => {
    it('imports buildStaleImplementedByCypher from @grasp-it/core', () => {
      expect(SKILL_CONTENT).toContain("buildStaleImplementedByCypher");
      // The import must come from the @grasp-it/core package (not from a
      // local path) so it resolves against the published package.
      expect(SKILL_CONTENT).toMatch(/buildStaleImplementedByCypher[\s\S]{0,200}@grasp-it\/core/);
    });

    it('does not call findStaleImplementedBy (the JSON-side function) — uses Cypher API instead', () => {
      // The skill must use the Neo4j-side API; findStaleImplementedBy operates
      // on a KnowledgeGraph object and would require loading the JSON, which
      // defeats the design intent.
      expect(SKILL_CONTENT).not.toMatch(/findStaleImplementedBy\s*\(/);
    });
  });

  describe('git usage', () => {
    it('calls git rev-parse HEAD to obtain the current commit', () => {
      // Match the full invocation including -C "$PROJECT_ROOT" — the skill
      // runs git with an explicit -C flag to respect the worktree redirect.
      expect(SKILL_CONTENT).toMatch(/git\s+-C\s+"\$PROJECT_ROOT"\s+rev-parse\s+HEAD/);
    });

    it('uses -C "$PROJECT_ROOT" so git runs in the right working directory', () => {
      // The worktree-redirect logic only sets PROJECT_ROOT; subsequent git
      // calls must respect it. A bare "git rev-parse HEAD" without -C would
      // fail when the agent's CWD is not the project root.
      expect(SKILL_CONTENT).toMatch(/git\s+-C\s+"\$PROJECT_ROOT"\s+rev-parse\s+HEAD/);
    });
  });

  describe('Cypher queries', () => {
    it('passes $currentCommit as a Cypher parameter (not interpolated into the string)', () => {
      // buildStaleImplementedByCypher returns a query with $currentCommit;
      // the skill must NOT inline a literal commit hash into the Cypher
      // passed to run-query.mjs.
      expect(SKILL_CONTENT).toContain('$currentCommit');
    });

    it('passes the params bag as a third positional argument to run-query.mjs', () => {
      // The skill uses the new params-bag support added to run-query.mjs.
      // It must pass CYPHER_PARAMS (or equivalent JSON) as argv[4].
      // Find each line that invokes run-query.mjs and count the quoted args
      // that follow the script path.
      const lines = SKILL_CONTENT.split('\n');
      const callLines = lines.filter((l) => /run-query\.mjs/.test(l) && /node\s+/.test(l));
      expect(callLines.length).toBeGreaterThan(0);
      const passes3Args = callLines.some((l) => {
        // Strip the path up to and including run-query.mjs, then count
        // remaining double-quoted args.
        const idx = l.indexOf('run-query.mjs');
        const tail = l.slice(idx);
        const args = tail.match(/"[^"]+"/g) || [];
        return args.length >= 3;
      });
      expect(passes3Args).toBe(true);
    });

    it('queries Domain ancestors via HAS_FEATURE / HAS_OPERATION traversal', () => {
      // The grouping query must walk Domain ←—Feature—HAS_OPERATION—→Operation.
      expect(SKILL_CONTENT).toMatch(/HAS_FEATURE/);
    });

    it('implements sourceFiles directory fallback for unscoped nodes', () => {
      expect(SKILL_CONTENT).toMatch(/sourceFiles/);
      // The fallback should compute a top-level directory from sourceFiles.
      expect(SKILL_CONTENT).toMatch(/top[\s_-]?level/i);
    });
  });

  describe('ranking', () => {
    it('sorts by stale count DESC', () => {
      // The brief requires ranking by stale count DESC, then oldest commit ASC.
      // Either an explicit comment, a `sort` call, or a sentence is sufficient.
      const rankBlock = SKILL_CONTENT.match(/###\s*Phase 5:[\s\S]*?(?=###\s*Phase 6:)/);
      expect(rankBlock).not.toBeNull();
      expect(rankBlock[0]).toMatch(/stale\s+count/i);
      expect(rankBlock[0]).toMatch(/DESC/i);
    });

    it('breaks ties by oldest analyzedAtCommit ASC', () => {
      const rankBlock = SKILL_CONTENT.match(/###\s*Phase 5:[\s\S]*?(?=###\s*Phase 6:)/);
      expect(rankBlock[0]).toMatch(/oldest|analyzedAtCommit/i);
      expect(rankBlock[0]).toMatch(/ASC/i);
    });
  });

  describe('no auto-refresh', () => {
    it('does not auto-invoke /grasp --full', () => {
      // The skill must NOT call /grasp --full on the user's behalf. It should
      // only suggest it as a user-driven next step.
      //
      // A bare `/grasp --full` inside a recommendation string is fine; the
      // prohibition is on auto-invocation (e.g. `node .../run-grasp.mjs --full`
      // or `RUN_GRASP=1` or `bash -c '/grasp --full'`).
      expect(SKILL_CONTENT).not.toMatch(/--auto-update|--review/);
    });

    it('tells the user that the skill does not auto-refresh', () => {
      expect(SKILL_CONTENT).toMatch(/does not auto-refresh/i);
    });

    it('recommends /grasp-domain or /grasp --full as user actions', () => {
      // One of these should appear as a recommended next step.
      const recommends = SKILL_CONTENT.match(/\/grasp-domain|\/grasp --full/g) || [];
      expect(recommends.length).toBeGreaterThan(0);
    });
  });

  describe('regression: no global freshness check pattern', () => {
    it('does NOT contain the Project.gitCommitHash global freshness pattern', () => {
      expect(SKILL_CONTENT).not.toContain(FRESHNESS_PATTERN);
    });

    it('does NOT compare git rev-parse HEAD to gitCommitHash for freshness', () => {
      // The pattern: query Project for gitCommitHash, compare to git rev-parse HEAD.
      const lines = SKILL_CONTENT.split('\n');
      const offending = lines.filter((line) =>
        line.includes('git rev-parse HEAD')
        && /stale|freshness|behind|analyzed at/i.test(line),
      );
      expect(offending).toEqual([]);
    });

    it('does NOT define or use $LAST_COMMIT as a freshness signal', () => {
      expect(SKILL_CONTENT).not.toMatch(/^LAST_COMMIT=/m);
      expect(SKILL_CONTENT).not.toContain('$LAST_COMMIT');
    });
  });

  describe('worktree redirect', () => {
    it('includes the worktree-redirect block from other skills', () => {
      // The skill should redirect to main repo root when run in a worktree.
      expect(SKILL_CONTENT).toMatch(/git[\s_-]?common[\s_-]?dir/i);
      expect(SKILL_CONTENT).toMatch(/UNDERSTAND_NO_WORKTREE_REDIRECT/);
    });
  });
});
