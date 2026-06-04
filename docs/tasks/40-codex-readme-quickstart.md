# Task 40: Add Codex/ChatGPT Quick Start to README

## Background

`README.md` Quick Start (lines ~55–58) uses Claude Code slash commands
(`/plugin marketplace add`, `/plugin install grasp-it`). Non-developer Codex and ChatGPT
users have no path to follow — these commands don't exist in their environment. The
installer (`install.sh` / `install.ps1`) supports Codex as a target platform but is not
prominently documented for non-developer users.

## Actions

### 40.1 Add a Codex/ChatGPT Quick Start section to README

Add a parallel Quick Start section (or expand the existing one) for Codex/ChatGPT users:

- Show the one-line curl installer for macOS/Linux:
  ```bash
  curl -fsSL <installer-url> | bash -s -- codex
  ```
- Show the PowerShell equivalent for Windows
- Explain what gets installed and where (no developer terminology)
- Show how to run the first `/grasp` scan after install
- Note that Neo4j credentials are requested on first run (after task 38 is complete)

### 40.2 Verify the Codex install path end-to-end

Manually trace the install instructions in the README against what `install.sh codex`
actually does. Confirm:

- The skill files land in the correct directory for Codex to discover them
- The instructions are accurate and complete for a non-developer user
- No step requires developer tools (pnpm, npm install, build commands)

## Acceptance Criteria

- README contains a working Quick Start for Codex/ChatGPT users
- Instructions are verified against what `install.sh codex` actually does
- No developer-tool steps (pnpm, npm) are required of the user
- Commit: `docs: add Codex/ChatGPT Quick Start to README`
