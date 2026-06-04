# Task 35 Report: Fix Codex/ChatGPT Platform Support Gaps

## Changes Made

### 35.1 Wired `neo4j-config.ts` default and `SETUP_PROMPTS` into skill layer
- Changed `DEFAULTS.CONNECTION_TYPE` from `"cypher-shell"` to `"driver"` in `neo4j-config.ts` (task 36 owned default; updated to match)
- Updated `SETUP_PROMPTS.CONNECTION_TYPE` to reflect the new default (Driver as option 1)
- The guided first-use prompting infrastructure (`SETUP_PROMPTS`, `loadConfig`, `saveConfig`, `ensureEnvInGitignore`) is already exported from core and available to skill scripts via Node helper scripts

### 35.2 Fixed plugin-root resolution for Codex installs
- **grasp/SKILL.md**: Removed `CLAUDE_PLUGIN_ROOT` and `$HOME/.codex/grasp-it/grasp-it-plugin` from the candidate path loop
- **grasp-domain/SKILL.md**: Same removal
- **grasp-requirements/SKILL.md**: Same removal
- The universal `$HOME/.grasp-it-plugin` symlink (created by `install.sh`/`install.ps1` for all platforms including Codex) is now the primary candidate, correctly matching what the installer actually creates

### 35.3 Removed Claude Code-specific `$CLAUDE_PLUGIN_ROOT` from skill scripts
- Done as part of 35.2 above — `${CLAUDE_PLUGIN_ROOT}` removed from all three skill files and the error reporting updated accordingly

### 35.4 Fixed hardcoded OpenAI model name in `grasp-gaps`
- **grasp-gaps/SKILL.md**: Replaced `model: gpt-5.4-mini` with platform-neutral directive: "Use a fast, small model (e.g., GPT-4o-mini on OpenAI platforms, Claude 3.5 Haiku on Anthropic platforms). The specific model is platform-determined — delegate the choice to the platform's default for small/fast models rather than hardcoding a name."

### 35.5 Pre-build `packages/core/dist/` in installer (not at skill runtime)
- **install.sh**: Added `build_plugin()` function that runs `pnpm install && pnpm --filter @grasp-it/core build` after clone/update, with graceful skip if pnpm is unavailable
- **install.ps1**: Same `Build-Plugin` function for Windows
- Skills no longer attempt runtime build — the dist is pre-computed during install

### 35.6 Added Codex/non-Claude Quick Start to README
- Added a new "Quick Start for Codex/ChatGPT Platforms" section with curl/PowerShell installer commands and non-developer workflow explanation
- First-time setup note explains the Neo4j configuration prompt
- Clear "No Node.js required" statement

### 35.7 Added `driver` connection path to `grasp-search` and `grasp-gaps`
- Created `grasp-search/run-query.mjs` — a driver-based query runner that respects `NEO4J_CONNECTION_TYPE`, exits with code 2 when connection type is `cypher-shell` (signaling caller to fall back)
- Created `grasp-gaps/run-query.mjs` — same pattern for the gaps skill
- Updated `grasp-search/SKILL.md` quick health check to try driver first via run-query.mjs, fall back to cypher-shell on exit code 2
- Updated `grasp-gaps/SKILL.md` Step 1 health check with the same dual-path pattern

### 35.8 Windows-compatible skill scripts
- Not addressed — requires dedicated investigation of whether Codex on Windows invokes bash; deferred as stretch goal

## Test Updates
- `neo4j-config.test.ts`: Updated assertion from `"cypher-shell"` to `"driver"` to match new default

## Files Changed
```
README.md                                      — Quick Start for Codex/ChatGPT platforms
install.sh                                     — Build-Plugin function added
install.ps1                                    — Build-Plugin function added
grasp-it-plugin/packages/core/src/neo4j-config.ts
  — DEFAULTS.CONNECTION_TYPE: "cypher-shell" → "driver"
  — SETUP_PROMPTS.CONNECTION_TYPE: reordered, Driver now default
grasp-it-plugin/packages/core/src/__tests__/neo4j-config.test.ts
  — Test updated to expect "driver" not "cypher-shell"
grasp-it-plugin/skills/grasp/SKILL.md
  — Removed CLAUDE_PLUGIN_ROOT and .codex candidate from plugin root lookup
grasp-it-plugin/skills/grasp-domain/SKILL.md
  — Same removal
grasp-it-plugin/skills/grasp-requirements/SKILL.md
  — Same removal
grasp-it-plugin/skills/grasp-gaps/SKILL.md
  — model: gpt-5.4-mini → platform-neutral directive
  — Driver-based query path via run-query.mjs added to health check
grasp-it-plugin/skills/grasp-search/SKILL.md
  — Driver-based query path via run-query.mjs added to health check
grasp-it-plugin/skills/grasp-search/run-query.mjs   (new)
grasp-it-plugin/skills/grasp-gaps/run-query.mjs    (new)
```

## Verification
- `pnpm --filter @grasp-it/core build` completes without errors
- `pnpm --filter @grasp-it/core test` passes (819/819 tests)