# Task 42 Report: Fix README Installer Commands Missing `codex` Platform Argument

## Status: Complete

## Changes Made

### README.md - Two sections updated

**Section 1: "Quick Start for Codex/ChatGPT Platforms" (lines 104, 107)**

Bash command changed from:
```bash
curl -fsSL https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.sh | bash
```
to:
```bash
curl -fsSL https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.sh | bash -s -- codex
```

PowerShell command changed from:
```powershell
iwr -useb https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.ps1 | iex
```
to:
```powershell
& ([scriptblock]::Create((iwr -useb https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.ps1).Content)) codex
```

**Section 2: "Installation on Other Platforms" (lines 223, 228)**

Same changes applied to the duplicate installer commands in this section.

## Verification

- `install.sh` lines 11-13 document the `bash -s -- codex` form for curl-pipe usage
- `install.ps1` accepts `codex` as a positional `Platform` parameter (line 16-17)
- The `scriptblock::Create` form allows passing positional arguments when piping to `iex`, which was not possible with the original one-liner

## Acceptance Criteria Met

- Both curl and PowerShell commands now include the `codex` platform argument
- Both commands complete non-interactively when piped (no interactive prompt triggered)
- Commands are consistent with the parameter signatures in `install.sh` and `install.ps1`
