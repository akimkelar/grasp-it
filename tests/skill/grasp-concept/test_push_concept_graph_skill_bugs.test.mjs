/**
 * Tests for BUGS reported in
 *   ~/.grasp-it/bug-reports/2026-06-24_10-58_grasp-interview-report.md
 *
 * BUG-01 (post-fix, script-side): PascalCase "BusinessRule" in the `type`
 *         field of pr-nodes.json must be REJECTED with a specific error
 *         message that points to the kebab-case form and SKILL.md. The
 *         previous defence-in-depth `normaliseNodeType()` mask hid LLM
 *         confusion about which form to use; the safety net is gone.
 * BUG-01 (SKILL.md):              Narrative instructions that tell the LLM
 *         to create BusinessRule nodes must use the kebab-case
 *         "business-rule" form, matching the type table and ID prefix
 *         convention.
 * BUG-02:                         push-concept-graph.mjs must exit non-zero
 *         when any node is rejected (currently exits 0 even with skipped
 *         nodes, masking data loss).
 * BUG-03:                         SKILL.md must define a fallback trigger
 *         for topic-driven concept plan sessions (the LLM should write to
 *         the graph after a bounded number of substantive answers even
 *         without a formal aspect paraphrase-check).
 * BUG-04:                         SKILL.md must include a mandatory
 *         cross-aspect checklist that scans for Operations, Constraints,
 *         Claims, and Actors — the per-aspect lists alone produce sparse
 *         graphs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const SKILL_PATH = join(
  REPO_ROOT,
  "grasp-it-plugin/skills/grasp-concept/SKILL.md",
);
const SCRIPT_PATH = join(
  REPO_ROOT,
  "grasp-it-plugin/skills/grasp-concept/push-concept-graph.mjs",
);

function runPushConceptGraph(projectRoot, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(extraEnv)) {
    if (val === undefined) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  // Strip cypher-shell from PATH so the cypher-shell fallback in push-concept-graph.mjs
  // fails fast (ENOENT) instead of hanging on an unreachable port. This makes the tests
  // independent of whether cypher-shell is installed in the test environment.
  if (env.PATH && !extraEnv.PATH) {
    env.PATH = env.PATH
      .split(":")
      .filter(p => !existsSync(join(p, "cypher-shell")))
      .join(":");
  }
  return spawnSync("node", [SCRIPT_PATH, projectRoot], {
    encoding: "utf-8",
    env,
    timeout: 25_000,
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("BUG-01 (post-fix): PascalCase 'BusinessRule' is rejected with a specific error", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "concept-bug1-fix-"));
    mkdirSync(join(root, ".grasp-it", "intermediate"), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function writeGraph(nodes = [], edges = []) {
    writeFileSync(
      join(root, ".grasp-it", "intermediate", "pr-nodes.json"),
      JSON.stringify({ nodes }),
    );
    writeFileSync(
      join(root, ".grasp-it", "intermediate", "pr-edges.json"),
      JSON.stringify({ edges }),
    );
  }

  it("rejects a PascalCase 'BusinessRule' type with a specific error", () => {
    writeGraph([
      {
        id: "business-rule:foo",
        name: "Foo Rule",
        summary: "Test rule",
        type: "BusinessRule", // PascalCase — the bug case
      },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
      // No mock — validation must reject before driver/cypher-shell is invoked.
    });

    // Specific error for the PascalCase input
    expect(result.stderr).toContain("Unknown node type 'BusinessRule'");
    // Error must suggest the kebab-case form
    expect(result.stderr).toContain("'business-rule'");
    // Error must reference SKILL.md so the LLM knows where to look
    expect(result.stderr).toMatch(/SKILL\.md/);
    // Hard fail: no MERGE generated for the bad node
    expect(result.stderr).not.toMatch(/MERGE \(n:Knowledge.*business-rule:foo/);
    // Hard fail: non-zero exit code
    expect(result.status).not.toBe(0);
  });

  it("rejects PascalCase for other node types (Feature, Domain) with the same helpful error", () => {
    writeGraph([
      { id: "feature:foo", name: "Foo", summary: "Foo", type: "Feature" },
      { id: "domain:bar", name: "Bar", summary: "Bar", type: "Domain" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
    });

    expect(result.stderr).toContain("Unknown node type 'Feature'");
    expect(result.stderr).toContain("Unknown node type 'Domain'");
    // Both should suggest the kebab-case form
    expect(result.stderr).toMatch(/use 'feature' instead of 'Feature'/);
    expect(result.stderr).toMatch(/use 'domain' instead of 'Domain'/);
    expect(result.status).not.toBe(0);
  });

  it("rejects PascalCase plural 'BusinessRules' (no trailing-s safety net)", () => {
    // Previously normalised via `replace(/s$/, "")` in `normaliseNodeType()`.
    // With the safety-net removed, this must now fail loudly so the LLM
    // sees and fixes the typo instead of having it silently mangled.
    writeGraph([
      { id: "business-rule:foo", name: "Foo", summary: "Foo", type: "BusinessRules" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
    });

    expect(result.stderr).toContain("Unknown node type 'BusinessRules'");
    expect(result.status).not.toBe(0);
  });

  it("rejects a mixed batch (PascalCase + kebab-case) without writing any nodes", () => {
    writeGraph([
      { id: "business-rule:bad", name: "Bad", summary: "Bad", type: "BusinessRule" },
      { id: "feature:good", name: "Good", summary: "Good", type: "feature" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
    });

    // The bad node's error must appear
    expect(result.stderr).toContain("Unknown node type 'BusinessRule'");
    // The good node must NOT have been written (no MERGE for it) — atomic push
    expect(result.stderr).not.toMatch(/MERGE \(n:Knowledge.*feature:good/);
    expect(result.status).not.toBe(0);
  });

  it("rejects a genuinely unknown type and lists the known types", () => {
    writeGraph([
      { id: "foobar:bad", name: "Bad", summary: "Bad", type: "foobar" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
    });

    expect(result.stderr).toContain("Unknown node type 'foobar'");
    // Error must list the canonical kebab-case types
    expect(result.stderr).toContain("business-rule");
    expect(result.stderr).toContain("feature");
    expect(result.stderr).toMatch(/SKILL\.md/);
    expect(result.status).not.toBe(0);
  });
});

describe("BUG-01: SKILL.md distinguishes JSON 'type' (kebab-case) from Neo4j label (PascalCase)", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");

  it("explicitly instructs the LLM to write the lowercase/kebab-case 'type' value, not the PascalCase Neo4j label", () => {
    // The bug: the LLM wrote `"type": "BusinessRule"` into pr-nodes.json
    // because the SKILL.md narrative used PascalCase `BusinessRule` for the
    // node type. The Neo4j label IS `BusinessRule` (the truth), but the JSON
    // `type` field is normalised to kebab-case internally. The fix is to make
    // this distinction explicit in the SKILL.md — the LLM needs to know when
    // to write which form.
    expect(content).toMatch(/`type` value.*lowercase|kebab-case.*`type`|internal.*`type`|JSON `type` field|kebab-case/i);
  });

  it("the type table lists the JSON `type` value in kebab-case (not PascalCase)", () => {
    // The table at line ~42-53 lists node types. The `business-rule` row
    // must use kebab-case (it's the only multi-word type, so it's the
    // easiest place for the LLM to mistakenly see PascalCase as canonical).
    const tableMatch = content.match(
      /\| Node type \| Description \| Behavior in planning \|([\s\S]*?)(?=\n\n|\n### )/,
    );
    expect(tableMatch).not.toBeNull();
    const table = tableMatch[1];
    expect(table).toMatch(/\| `business-rule` \|/);
    // The PascalCase `BusinessRule` should NOT appear as a row key in the
    // type table — that's what misled the LLM originally.
    expect(table).not.toMatch(/\| `BusinessRule` \|/);
  });

  it("explains the PascalCase → kebab-case mapping for the multi-word type", () => {
    // The SKILL.md must mention that `business-rule` → `BusinessRule` is the
    // only multi-word mapping, so the LLM doesn't get confused about when
    // to use which form.
    expect(content).toMatch(/`business-rule`.*`BusinessRule`|multi-word/i);
  });
});

describe("BUG-02: push script exits non-zero when nodes are skipped", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "concept-bug2-"));
    mkdirSync(join(root, ".grasp-it", "intermediate"), { recursive: true });
  });

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function writeGraph(nodes = [], edges = []) {
    writeFileSync(
      join(root, ".grasp-it", "intermediate", "pr-nodes.json"),
      JSON.stringify({ nodes }),
    );
    writeFileSync(
      join(root, ".grasp-it", "intermediate", "pr-edges.json"),
      JSON.stringify({ edges }),
    );
  }

  it("exits non-zero when at least one node is skipped due to unknown type", () => {
    // NEO4J_TEST_MOCK_FAIL_TIMES=0 makes the mock driver succeed immediately
    // (no real connection, no real DB), so the script reaches the success
    // path. With the bug, this prints "Concept graph pushed to Neo4j
    // successfully." and exits 0 even though a node was skipped. The fix
    // must surface the skip in the exit code.
    writeGraph([
      { id: "foobar:bad", name: "Bad", summary: "Unknown", type: "foobar" },
      { id: "feature:good", name: "Good", summary: "Valid", type: "feature" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
      NEO4J_TEST_MOCK_FAIL_TIMES: "0",
      PATH: "/usr/local/bin:/usr/bin:/bin",
    });

    // The warning was emitted
    expect(result.stderr).toContain("Unknown node type 'foobar'");
    // The script must NOT exit 0 when a node was silently dropped
    expect(result.status).not.toBe(0);
  });

  it("error message reports how many nodes were rejected due to unknown type", () => {
    writeGraph([
      { id: "feature:good", name: "Good", summary: "Valid", type: "feature" },
      { id: "foobar:bad", name: "Bad", summary: "Unknown", type: "foobar" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
      NEO4J_TEST_MOCK_FAIL_TIMES: "0",
      PATH: "/usr/local/bin:/usr/bin:/bin",
    });

    // The output must report how many were rejected so the LLM can see
    // at a glance that a node was dropped. With the atomic-rejection
    // behavior, the error message includes both the rejected count
    // and the batch total (e.g. "1 of 2 node(s) skipped").
    const combined = (result.stdout || "") + (result.stderr || "");
    expect(combined).toMatch(/1[\s\S]*node[\s\S]*skip/i);
    // The script must exit non-zero
    expect(result.status).not.toBe(0);
  });

  it("success message with no skipped nodes reports the count of written nodes", () => {
    writeGraph([
      { id: "feature:good", name: "Good", summary: "Valid", type: "feature" },
    ]);

    const result = runPushConceptGraph(root, {
      NEO4J_URI: "neo4j://localhost:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "password",
      NEO4J_DATABASE: "grasp",
      NEO4J_TEST_MOCK_FAIL_TIMES: "0",
      PATH: "/usr/local/bin:/usr/bin:/bin",
    });

    // The clean-success path reports both counts (zero skipped) and exits 0.
    const combined = (result.stdout || "") + (result.stderr || "");
    expect(combined).toMatch(/1\s*node.*written/);
    expect(combined).toMatch(/0\s*node.*skip/i);
    expect(result.status).toBe(0);
  });
});

describe("BUG-03: SKILL.md defines a topic-driven fallback trigger", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");

  it("contains a periodic-write fallback trigger for topic-driven concept plan sessions", () => {
    // The bug: when the specialist drives the conversation substantively
    // (rich context upfront), the eight-aspect structure is not traversed
    // sequentially and the LLM batches the entire first write to the end.
    // Fix: a count-based fallback that pauses the concept plan session to
    // write what has been established so far, even if the current aspect
    // is not formally complete.
    expect(content).toMatch(/3 or more substantive|substantive questions? without/i);
  });

  it("fallback trigger instructs the LLM to pause and write what is established so far", () => {
    // The fallback must explicitly say: write now even without an aspect
    // paraphrase-check, using a partial paraphrase to confirm understanding.
    expect(content).toMatch(/pause and write|capture what we.*established/i);
  });

  it("fallback trigger is positioned in the 'Writing to the Graph After Each Aspect' section", () => {
    // Locate the "Writing to the Graph After Each Aspect" section.
    const sectionMatch = content.match(
      /### Writing to the Graph After Each Aspect([\s\S]*?)(?=\n### |\n## )/,
    );
    expect(sectionMatch).not.toBeNull();
    const section = sectionMatch[1];
    // The fallback trigger must live in this section so the LLM sees it
    // whenever it consults the write cadence.
    expect(section).toMatch(/3 or more substantive|substantive questions? without/i);
  });
});

describe("BUG-04: SKILL.md has a mandatory cross-aspect checklist", () => {
  const content = readFileSync(SKILL_PATH, "utf-8");

  it("contains a mandatory scan-the-conversation step", () => {
    // The bug: per-aspect lists omit Operations, Constraints, Claims, and
    // Actors, leading to sparse first writes. Fix: a checklist the LLM
    // cannot skip that forces it to scan the conversation for each of
    // these node types.
    expect(content).toMatch(/scan the conversation/i);
  });

  it("checklist covers named action → Operation node", () => {
    // The regex accommodates backticks in the markdown (`Operation`) since
    // the SKILL.md wraps type names in backticks for code-style emphasis.
    expect(content).toMatch(/named action.*Operation/i);
  });

  it("checklist covers hedged/uncertain statement → Claim node", () => {
    expect(content).toMatch(/hedged.*Claim|uncertain.*Claim/i);
  });

  it("checklist covers 'must always be true' → Constraint node", () => {
    expect(content).toMatch(/must always be true.*Constraint/i);
  });

  it("checklist covers actor mentioned → PERFORMED_BY edge", () => {
    // Accept any whitespace between PERFORMED_BY and edge (handles backticks).
    expect(content).toMatch(/PERFORMED_BY.*edge/i);
  });

  it("checklist is reinforced as non-optional", () => {
    // Without a 'not optional' or 'mandatory' framing, the LLM skips the
    // checklist when rushing.
    expect(content).toMatch(/not optional|mandatory|incomplete without them/i);
  });
});