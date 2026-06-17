---
name: grasp-report-bug
description: Analyzes a grasp-it skill run that already happened in this conversation and produces a bug report. The user runs the plugin skill first, then invokes /grasp-report-bug to review what went wrong. Usage: /grasp-report-bug [--skill grasp|grasp-domain|grasp-search|grasp-diff|grasp-explain|grasp-gaps]
---

# Grasp-It Report Bug Skill

Analyze the grasp-it skill execution that already took place in this conversation and produce
a bug report for the plugin repository.

**Do not re-run the skill.** Do not issue Bash commands to reproduce failures. The evidence
is already in the conversation: tool outputs, error messages, exit codes, Neo4j state queries,
and the LLM decisions made during the run. Read that evidence and derive findings from it.

## Arguments

- `--skill <name>` — audit only the named skill's execution
- No argument — audit all skill runs found in the conversation

Valid skill names: `grasp`, `grasp-domain`, `grasp-search`, `grasp-diff`, `grasp-explain`, `grasp-gaps`

---

## General info about plugin

The documentation about the plugin is under
`$GRASP_REPO_ROOT` (i.e. `~/.grasp-it/repo`)
Important files are:
- docs/architecture/neo4j-schema.md
- docs/graph/architecture.md
- CLAUDE.md
- README.md

## How to Audit

### Step 1 — Identify the skill run in the conversation

Scroll back through the conversation to find where the skill was invoked and trace its
execution. Note:
- Which skill was run and with what arguments
- What the LLM did at each phase (which Bash commands, which reads, which writes)
- Every non-zero exit code
- Every error message in stdout/stderr
- Every place where the LLM deviated from or worked around the SKILL.md instructions
- What ended up in Neo4j vs what the skill promised

### Step 2 — Read the skill's SKILL.md

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/grasp-it/grasp-it/*/ 2>/dev/null | sort -V | tail -1 | sed 's|/$||')
cat "$PLUGIN_ROOT/skills/<skill-name>/SKILL.md"
```

Read it fully. For each phase, understand what the skill says should happen. This is your
reference for "expected behaviour".

### Step 3 — Read the domain-analyzer agent prompt (for grasp-domain audits)

```bash
cat "$PLUGIN_ROOT/agents/domain-analyzer.md"
```

Cross-check what the agent was actually given in the conversation against what this file
specifies.

### Step 4 — Resolve variables for the report

```bash
GRASP_REPO_ROOT="$HOME/.grasp-it/repo"
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/grasp-it/grasp-it/*/ 2>/dev/null | sort -V | tail -1 | sed 's|/$||')
PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null)
REPORT_DIR="$HOME/.grasp-it/bug-reports"
REPORT_FILE="$REPORT_DIR/$(date '+%Y-%m-%d_%H-%M')_grasp-report-bug.md"
mkdir -p "$REPORT_DIR"
echo "PLUGIN_ROOT=$PLUGIN_ROOT  VERSION=$PLUGIN_VERSION"
echo "REPORT_FILE=$REPORT_FILE"
```

NOTE: report file contains date_time without seconds, which should not be guessed, but calculated.

---

## What Counts as a Bug

Include a finding **only if**:

- A command exited non-zero when the skill documentation says it should succeed
- A skill completed but Neo4j state did not match the documented expected output
- A documented argument had no observable effect when used
- Two instructions in the same skill contradict each other (cite both line numbers)
- A skill instruction references a tool, script, or agent file that does not exist
- The LLM was forced to work around a script failure (patching output, bypassing a step,
  writing manual Cypher instead of using the provided script)
- The LLM paraphrased an agent prompt rather than passing it verbatim, and the paraphrase
  omitted required fields — caused by insufficient instruction in the SKILL.md

**Do not include:**
- "Could be better" observations
- Scale or UX suggestions
- Anything that worked correctly but could work differently

---

## Report Format

Write the report to `$REPORT_FILE`.

```markdown
# Grasp-It Plugin Bug Report

**Date:** <date>
**Plugin version:** <version>
**Skills audited:** <list>
**Bugs found:** <n>

---

## BUG-01 — <title>

**Skill:** `/grasp-domain`
**Phase:** Phase 6b
**Severity:** critical | major | minor

**Expected behaviour** (from skill documentation):
<quote the relevant SKILL.md line(s)>

**Actual behaviour:**
<what happened — reference the specific conversation turn>

**Evidence:**
```
<exact command, exact stdout+stderr, exact exit code — copied from the conversation>
```

**Fix suggestion:** <one concrete fix, if obvious>

**Location in plugin:** `skills/grasp-domain/push-domain-graph.mjs:104`
```

One section per bug. Do not group bugs. Do not summarize across bugs.
