# Task 35: Fix Codex/ChatGPT Platform Support Gaps

## Background

Grasp-it is designed primarily for non-developer users on Codex (OpenAI) and ChatGPT,
including Windows users — but several implementation gaps prevent it from working
correctly outside Claude Code. Task 13 addressed configuration documentation but did not
fully deliver the non-developer-friendly setup experience, and left dead code and wrong
defaults behind.

## Gaps to Address

### 35.1 Wire `neo4j-config.ts` into the skill layer

`neo4j-config.ts` is exported from core but never called by any skill or agent. The only
integration is a passive bash `source .env` snippet in `grasp/SKILL.md`. Implement actual
first-use guided prompting in skills:

- On first invocation of any `/grasp-*` skill when no Neo4j config is found, prompt the
  user interactively for connection type, URI, database, username, and password
- Write the resulting `.env` file
- Add `.env` to `.gitignore` automatically
- This is the guided setup flow Task 13 designed but did not implement in the skill layer

### 35.2 Fix plugin-root resolution for Codex installs

**Files:** `grasp-it-plugin/skills/grasp/SKILL.md`,
`grasp-it-plugin/skills/grasp-domain/SKILL.md`,
`grasp-it-plugin/skills/grasp-requirements/SKILL.md`

The plugin-root lookup checks `$HOME/.codex/grasp-it/grasp-it-plugin`, but the installer
(`install.sh codex`) clones to `$HOME/.grasp-it/repo` and creates `$HOME/.grasp-it-plugin`
as a symlink — not `~/.codex/grasp-it/`. Update the Codex-specific candidate path to
match what the installer actually creates, or remove it in favour of the generic
`$HOME/.grasp-it-plugin` fallback (which the installer already creates for all platforms).

### 35.3 Remove Claude Code-specific `$CLAUDE_PLUGIN_ROOT` from skill scripts

**Files:** `grasp-it-plugin/skills/grasp/SKILL.md` (line ~87),
`grasp-it-plugin/skills/grasp-domain/SKILL.md` (line ~58),
`grasp-it-plugin/skills/grasp-requirements/SKILL.md` (line ~78)

`${CLAUDE_PLUGIN_ROOT}` is a Claude Code-only env var. It gracefully expands to empty
string on other platforms, but it is a Claude Code concept leaking into portable skill
files. If `$HOME/.grasp-it-plugin` covers Claude Code and Codex installs equally after
the installer runs, remove the `CLAUDE_PLUGIN_ROOT` candidate or wrap it with a comment
explaining it is Claude Code-specific.

### 35.4 Fix hardcoded OpenAI model name in `grasp-gaps`

**File:** `grasp-it-plugin/skills/grasp-gaps/SKILL.md`

Line ~64 specifies `model: gpt-5.4-mini` in the delegation profile. This is an
OpenAI-specific model name embedded in a skill that also runs on Claude Code. On Claude
Code, this either fails or triggers an unexpected model selection. Replace with a
platform-neutral directive (e.g., "use a fast/small model" or platform-conditional
instructions) so the skill works correctly on both platforms.

### 35.5 Pre-build `packages/core/dist/` in the repository

**File:** `grasp-it-plugin/skills/grasp/SKILL.md` (Phase 0 build step)

Skills run `pnpm install --frozen-lockfile && pnpm --filter @grasp-it/core build` at
runtime if `dist/` is missing. Non-developer Codex/ChatGPT users on Windows have no path
to satisfy this (requires Node.js ≥ 22 and pnpm ≥ 10). Options:

- Commit the built `dist/` to the repository so it is available after cloning
- Or move the build step into the installer scripts (`install.sh` / `install.ps1`) which
  run in a controlled setup environment

Either approach must eliminate the runtime `pnpm` dependency for non-developer users.

### 35.6 Add Codex/non-Claude Quick Start to README

**File:** `README.md`

The current Quick Start (lines ~55–58) uses Claude Code slash commands
(`/plugin marketplace add`, `/plugin install`). Add a parallel section for Codex/ChatGPT
users that shows the curl/PowerShell installer path and explains the workflow in
non-developer terms.

### 35.7 Add `driver` connection path to `grasp-search` and `grasp-gaps`

**Files:** `grasp-it-plugin/skills/grasp-search/SKILL.md`,
`grasp-it-plugin/skills/grasp-gaps/SKILL.md`

These skills hardcode `cypher-shell` subprocess calls for all Neo4j queries. They have no
`driver` code path at all. After task 36 makes `driver` the default connection type, users
with `NEO4J_CONNECTION_TYPE=driver` will get no Neo4j results from these two skills.

Add a `driver`-based query path to each skill (via a new `.mjs` helper script or by calling
the existing `load-project-meta.mjs` pattern) so they respect `NEO4J_CONNECTION_TYPE` the
same way the core `/grasp` skill scripts will after task 36.

### 35.8 (Stretch) Windows-compatible skill scripts

All Phase 0 bash scripts in SKILL.md files use Unix constructs (`source`, `realpath`,
`readlink -f`, `$HOME`). On Windows Codex without WSL or Git Bash, these fail silently or
error. Investigate whether Codex on Windows invokes bash via Git Bash/WSL, and if not,
add PowerShell-compatible equivalents or a detection/fallback mechanism. This is the
largest structural gap and may warrant its own dedicated task.

## Acceptance Criteria

- `neo4j-config.ts` defaults to `driver` connection type (owned by task 36)
- First-use Neo4j guided prompting is wired into at least the main `/grasp` skill
- Plugin-root resolution paths match what `install.sh` and `install.ps1` actually create
- `model: gpt-5.4-mini` replaced with a platform-neutral directive in `grasp-gaps`
- `packages/core/dist/` is either committed or built during install, not at skill runtime
- README includes a Codex/ChatGPT non-developer Quick Start section
- Tests cover the updated `neo4j-config.ts` default and the first-use prompting flow
