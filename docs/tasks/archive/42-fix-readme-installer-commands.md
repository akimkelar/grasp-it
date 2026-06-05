# Task 42: Fix README Installer Commands Missing `codex` Platform Argument

## Background

Task 40 validation found that both installer commands in the Codex/ChatGPT Quick Start
section of `README.md` are missing the `codex` platform argument. Without it, `install.sh`
enters an interactive prompt and fails when piped (non-interactive context). The correct
usage is documented in `install.sh` lines 11–13 as `bash -s codex` or `bash -s -- codex`.

The PowerShell command has the same problem — `iwr ... | iex` with no platform argument
triggers the same interactive prompt failure.

## Actions

### 42.1 Fix the bash curl command

**File:** `README.md`

Update the curl command in the Codex/ChatGPT Quick Start section to include the platform
argument. Correct form:

```bash
curl -fsSL https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.sh | bash -s -- codex
```

### 42.2 Fix the PowerShell command

**File:** `README.md`

Update the PowerShell command to pass the platform argument. Research the correct syntax
for passing arguments when piping to `iex` in PowerShell, or use a two-step form that
avoids the piping limitation:

```powershell
& ([scriptblock]::Create((iwr -useb https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.ps1).Content)) codex
```

Or alternatively use a temp-file approach:
```powershell
iwr -useb https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.ps1 -OutFile install.ps1; .\install.ps1 codex; Remove-Item install.ps1
```

Choose whichever form is idiomatic and reliable for non-developer Windows users. Check
`install.ps1` to confirm the `codex` argument is accepted as the `Platform` parameter.

### 42.3 Verify both commands work non-interactively

Confirm (by tracing `install.sh` and `install.ps1` logic) that both commands, when run
with the `codex` argument, complete without requiring any interactive input beyond what the
installer explicitly prompts for.

## Acceptance Criteria

- Both curl and PowerShell commands in README include the `codex` platform argument
- Both commands complete non-interactively when piped
- The commands are consistent with the actual parameter signature in `install.sh` and
  `install.ps1`
- Commit: `fix: add codex platform argument to README installer commands`
