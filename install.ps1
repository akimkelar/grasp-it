<#
.SYNOPSIS
  Grasp-It installer for Windows (PowerShell).

.DESCRIPTION
  Clones the repo and creates skill symlinks/junctions for the chosen platform.

.EXAMPLE
  ./install.ps1                       # prompt for platform
  ./install.ps1 codex                 # install for codex
  ./install.ps1 -Update               # pull latest changes
  ./install.ps1 -Uninstall codex      # remove links for codex
#>

param(
    [Parameter(Position = 0)]
    [string]$Platform,
    [switch]$Update,
    [string]$Uninstall,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

$RepoUrl    = if ($env:UA_REPO_URL) { $env:UA_REPO_URL } else { 'https://github.com/akimkelar/Grasp-It.git' }
$RepoDir    = if ($env:UA_DIR)      { $env:UA_DIR }      else { Join-Path $HOME '.grasp-it\repo' }
$PluginLink = Join-Path $HOME '.grasp-it-plugin'

# Platform table — Target = skills directory; Style = "per-skill" | "folder"
$Platforms = [ordered]@{
    gemini      = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    codex       = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    opencode    = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    pi          = @{ Target = (Join-Path $HOME '.agents\skills');             Style = 'per-skill' }
    openclaw    = @{ Target = (Join-Path $HOME '.openclaw\skills');           Style = 'folder' }
    antigravity = @{ Target = (Join-Path $HOME '.gemini\antigravity\skills'); Style = 'folder' }
    vscode      = @{ Target = (Join-Path $HOME '.copilot\skills');            Style = 'per-skill' }
    hermes      = @{ Target = (Join-Path $HOME '.hermes\skills');             Style = 'folder' }
    cline       = @{ Target = (Join-Path $HOME '.cline\skills');              Style = 'folder' }
    kimi        = @{ Target = (Join-Path $HOME '.kimi\skills');               Style = 'folder' }
    trae        = @{ Target = (Join-Path $HOME '.trae\skills');               Style = 'per-skill' }
    claude      = @{ Target = (Join-Path $HOME '.claude\plugins\cache');       Style = 'claude' }
}

function Show-Usage {
    @"
Grasp-It installer (Windows)

Usage:
  install.ps1 [<platform>]                Install for <platform> (or prompt if omitted)
  install.ps1 -Update                     Pull latest changes
  install.ps1 -Uninstall <platform>       Remove links for <platform>
  install.ps1 -Help

Supported platforms:
$($Platforms.Keys -join ', ')

Environment:
  UA_REPO_URL   Override clone URL
  UA_DIR        Override clone destination (default: %USERPROFILE%\.grasp-it\repo)
"@
}

function Resolve-Platform([string]$Id) {
    if (-not $Platforms.Contains($Id)) {
        Write-Error "Unknown platform: $Id. Supported: $($Platforms.Keys -join ', ')"
    }
    return $Platforms[$Id]
}

function Prompt-Platform {
    $ids = @($Platforms.Keys)
    Write-Host 'Which platform are you installing for?'
    for ($i = 0; $i -lt $ids.Count; $i++) {
        Write-Host ("  {0}) {1}" -f ($i + 1), $ids[$i])
    }
    $choice = Read-Host ("Choose [1-{0}]" -f $ids.Count)
    $n = 0
    if (-not [int]::TryParse($choice, [ref]$n) -or $n -lt 1 -or $n -gt $ids.Count) {
        Write-Error "Invalid choice: $choice"
    }
    return $ids[$n - 1]
}

function Get-SkillsRoot { Join-Path $RepoDir 'grasp-it-plugin\skills' }

function Clone-Or-Update {
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Write-Host "→ Updating existing checkout at $RepoDir"
        git -C $RepoDir fetch origin
        git -C $RepoDir reset --hard origin/main
    } else {
        Write-Host "→ Cloning $RepoUrl → $RepoDir"
        $parent = Split-Path -Parent $RepoDir
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
        git clone $RepoUrl $RepoDir
    }
}

function Sync-Deps {
    # Always (re)install + rebuild. Idempotent; safe to call after every update.
    # gitignored dist/ survives `git reset --hard`, so a guard would skip new deps.
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) {
        Write-Host '  warning: pnpm not found — skipping install. Skills may need Node.js ≥ 22 and pnpm ≥ 10.'
        return
    }
    Write-Host '→ Syncing dependencies and rebuilding @grasp-it/core'
    Push-Location $RepoDir
    try {
        $lock = Join-Path $RepoDir 'pnpm-lock.yaml'
        if (Test-Path $lock) { Remove-Item -Force $lock }
        & pnpm install
        & pnpm --filter @grasp-it/core build
    } finally { Pop-Location }
}

function Install-ClaudePlugin {
    # Installs the plugin into Claude Code's plugin cache, or sets up the
    # plugin files for manual installation if Claude Code is not present.
    $pluginSrc = Join-Path $RepoDir 'grasp-it-plugin'
    $claudeCacheBase = Join-Path $HOME '.claude\plugins\cache'
    $pluginName = 'grasp-it'

    # Detect Claude Code version from the plugin's package.json
    $pluginVersion = '0.1.0'
    $pkgJson = Get-Content (Join-Path $pluginSrc 'package.json') -Raw -ErrorAction SilentlyContinue
    if ($pkgJson -match '"version"[[:space:]]*:[[:space:]]*"([^"]+)"') {
        $pluginVersion = $matches[1]
    }

    $cacheTarget = Join-Path $claudeCacheBase "$pluginName\$pluginName\$pluginVersion"

    $claude = Get-Command claude -ErrorAction SilentlyContinue
    if ($claude -and (Test-Path (Join-Path $HOME '.claude'))) {
        Write-Host "→ Installing Grasp-It plugin into Claude Code cache"
        $null = New-Item -ItemType Directory -Path (Join-Path $claudeCacheBase $pluginName) -Force
        $null = New-Item -ItemType Directory -Path (Join-Path $claudeCacheBase "$pluginName\$pluginName") -Force
        if (Test-Path $cacheTarget) { Remove-Item -Recurse -Force $cacheTarget }
        Copy-Item -Path $pluginSrc -Destination $cacheTarget -Recurse

        # pnpm uses symlinks in node_modules/ pointing into .pnpm/ — Copy-Item copies
        # the symlinks but not the virtual store, leaving broken links. Re-run
        # pnpm install to rebuild the virtual store inside the cache copy.
        $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
        if ($pnpm) {
            Write-Host '→ Running pnpm install in cache (fixing symlinks)...'
            Push-Location $cacheTarget
            try {
                $cacheLock = Join-Path $cacheTarget 'pnpm-lock.yaml'
                if (Test-Path $cacheLock) { Remove-Item -Force $cacheLock }
                & pnpm install
            } finally { Pop-Location }
        }

        Write-Host "  ✓ Plugin installed to $cacheTarget"

        # Detect whether an older version is already active vs. first install.
        $claudeList = & claude plugin list 2>$null
        $alreadyActive = $false
        foreach ($line in $claudeList) {
            if ($line -match '^grasp-it') { $alreadyActive = $true; break }
        }
        if ($alreadyActive) {
            Write-Host ''
            Write-Host '  An older version is active. To upgrade, restart Claude Code or run:'
            Write-Host '    /plugin update grasp-it'
        } else {
            Write-Host ''
            Write-Host '  Restart Claude Code to pick up the plugin, or run:'
            Write-Host '    /plugin marketplace add akimkelar/Grasp-It'
            Write-Host '    /plugin install grasp-it'
        }
    } else {
        Write-Host "→ Claude Code not detected — setting up plugin files for manual installation"
        Sync-Deps
        Link-Plugin-Root
        Write-Host ""
        Write-Host "  Claude Code not found on this system."
        Write-Host "  To use Grasp-It with Claude Code:"
        Write-Host "    1. Install Claude Code from https://docs.anthropic.com/en/docs/claude-code/"
        Write-Host "    2. Restart your terminal"
        Write-Host "    3. Run: /plugin marketplace add akimkelar/Grasp-It; /plugin install grasp-it"
    }
}

function Get-SkillNames {
    $root = Get-SkillsRoot
    if (-not (Test-Path $root)) { Write-Error "Skills directory not found: $root" }
    Get-ChildItem -Path $root -Directory | Select-Object -ExpandProperty Name
}

function Test-IsReparse([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    return ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink')
}

function Remove-Reparse([string]$Path) {
    # Removes a junction/symlink without touching its target. Refuses to touch
    # real files or directories so an existing user folder at the same path is
    # never destroyed.
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
        $item.Delete()
        return $true
    }
    Write-Warning "Refusing to delete $Path — it is a real file/directory, not a junction/symlink we created. Remove it manually if you intended to."
    return $false
}

function New-Junction([string]$LinkPath, [string]$TargetPath) {
    if (Test-Path $LinkPath) {
        if (Test-IsReparse $LinkPath) {
            (Get-Item -LiteralPath $LinkPath -Force).Delete()
        } else {
            Write-Error "Refusing to overwrite $LinkPath — it is a real file/directory, not a junction. Move or remove it first."
        }
    }
    New-Item -ItemType Junction -Path $LinkPath -Target $TargetPath | Out-Null
}

function Link-Skills([string]$Target, [string]$Style) {
    $root = Get-SkillsRoot
    if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target | Out-Null }

    switch ($Style) {
        'per-skill' {
            foreach ($skill in Get-SkillNames) {
                $link = Join-Path $Target $skill
                $src  = Join-Path $root $skill
                New-Junction $link $src
                Write-Host "  ✓ $link → $src"
            }
        }
        'folder' {
            $link = Join-Path $Target 'grasp-it'
            New-Junction $link $root
            Write-Host "  ✓ $link → $root"
        }
        'claude' {
            # Claude Code uses plugin cache installation instead of skill junctions.
            # Handled by Install-ClaudePlugin in Cmd-Install.
        }
        default { Write-Error "Unknown style: $Style" }
    }
}

function Unlink-Skills([string]$Target, [string]$Style) {
    if (-not (Test-Path $Target)) { return }
    switch ($Style) {
        'per-skill' {
            $skillsRoot = Get-SkillsRoot
            if (Test-Path $skillsRoot) {
                foreach ($skill in Get-SkillNames) {
                    Remove-Reparse (Join-Path $Target $skill) | Out-Null
                }
            } else {
                # Checkout is gone — scan the target dir for stale links pointing
                # into our plugin tree so we can still clean up.
                Get-ChildItem -LiteralPath $Target -Force | ForEach-Object {
                    if ($_.LinkType -eq 'Junction' -or $_.LinkType -eq 'SymbolicLink') {
                        if ($_.Target -match 'grasp-it-plugin[\\/]+skills[\\/]+') {
                            Remove-Reparse $_.FullName | Out-Null
                        }
                    }
                }
            }
        }
        'folder' {
            Remove-Reparse (Join-Path $Target 'grasp-it') | Out-Null
        }
        'claude' {
            # Remove the plugin from Claude Code's cache.
            $pluginVersion = '0.1.0'
            $pkgJson = Get-Content (Join-Path $RepoDir 'grasp-it-plugin\package.json') -Raw -ErrorAction SilentlyContinue
            if ($pkgJson -match '"version"[[:space:]]*:[[:space:]]*"([^"]+)"') {
                $pluginVersion = $matches[1]
            }
            $cachePath = Join-Path $Target "grasp-it\grasp-it\$pluginVersion"
            if (Test-Path $cachePath) {
                Remove-Item -Recurse -Force $cachePath
            }
        }
    }
}

function Link-Plugin-Root {
    if (Test-Path $PluginLink) {
        Write-Host "  • $PluginLink already exists, leaving as-is"
    } else {
        $src = Join-Path $RepoDir 'grasp-it-plugin'
        New-Item -ItemType Junction -Path $PluginLink -Target $src | Out-Null
        Write-Host "  ✓ $PluginLink → $src"
    }
}

function Cmd-Install([string]$Id) {
    $cfg = Resolve-Platform $Id
    Clone-Or-Update

    if ($Id -eq 'claude') {
        Install-ClaudePlugin
    } else {
        Sync-Deps
        Write-Host "→ Linking skills for $Id ($($cfg.Style) → $($cfg.Target))"
        Link-Skills $cfg.Target $cfg.Style
        Write-Host '→ Linking universal plugin root'
        Link-Plugin-Root

        Write-Host "`n✓ Installed Grasp-It for $Id"
        Write-Host '  Restart your CLI or IDE to pick up the skills.'
        if ($Id -eq 'vscode') {
            Write-Host "`n  Tip: VS Code can also auto-discover the plugin by opening this repo"
            Write-Host '       directly (it reads .copilot-plugin/plugin.json), no symlinks needed.'
        }
    }
}

function Cmd-Uninstall([string]$Id) {
    $cfg = Resolve-Platform $Id
    if ($Id -eq 'claude') {
        Write-Host "→ Removing Grasp-It plugin from Claude Code cache"
    } else {
        Write-Host "→ Removing skill links for $Id"
    }
    Unlink-Skills $cfg.Target $cfg.Style
    if (Remove-Reparse $PluginLink) {
        Write-Host "  ✓ removed $PluginLink"
    }
    if (Test-Path $RepoDir) {
        Write-Host "`nThe checkout at $RepoDir was kept (other platforms may still use it)."
        Write-Host "To remove it: Remove-Item -Recurse -Force '$RepoDir'"
    }
}

function Cmd-Update {
    if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
        Write-Error "No installation found at $RepoDir. Run install first."
    }
    git -C $RepoDir pull --ff-only
    try {
        Sync-Deps
    } catch {
        Write-Warning "git pull succeeded but dependency sync failed: $_"
    }
    Write-Host '✓ Updated (dependencies + core rebuild).'
}

if ($Help) { Show-Usage; return }
if ($Update) { Cmd-Update; return }
if ($Uninstall) { Cmd-Uninstall $Uninstall; return }

if (-not $Platform) { $Platform = Prompt-Platform }
Cmd-Install $Platform
