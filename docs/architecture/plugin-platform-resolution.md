# Plugin Root Resolution Across Platforms

## Overview

The grasp-it plugin is designed to run on multiple AI agent platforms — primarily **Claude Code** and **Codex/OpenAI** variants (including OpenCode and the `.pi` variant). Each platform installs and caches plugins differently. The plugin uses a **priority-ordered candidate resolution loop** rather than platform detection to find the correct plugin root at runtime.

## Platform Installation Layouts

### Claude Code

```
~/.claude/plugins/cache/grasp-it/grasp-it/<version>/
├── grasp-it-plugin/          ← actual files (not a symlink)
├── skills/
├── agents/
└── packages/core/dist/
```

- Plugins are cached at `~/.claude/plugins/cache/grasp-it/grasp-it/<version>/`
- Skills are installed at `~/.agents/skills/<skill-name>/` (symlinks into the cache)
- Running `/plugin update` downloads a new version to the cache directory
- **Critical issue:** `~/.agents/skills/<skill>` symlinks may lag behind the cache if the symlink itself isn't updated by the update command

### Codex / OpenAI Agents

```
~/.grasp-it-plugin                     ← symlink → local repo clone (v0.2.0 or older)
~/.copilot/skills/<skill-name>/        ← symlink into plugin checkout
~/.opencode/grasp-it/grasp-it-plugin/  ← direct clone
~/.pi/grasp-it/grasp-it-plugin/        ← alternate clone path
```

- No centralized plugin cache equivalent to Claude's
- The `~/.grasp-it-plugin` symlink is the conventional installation path
- Different Codex variants use slightly different install paths

## Resolution Priority Order

The skill files use a fixed-priority loop that tries candidate paths in this order:

```
1. ~/.claude/plugins/cache/grasp-it/grasp-it/<latest-version>/   ← Claude cache (PRIORITY)
2. ~/.grasp-it-plugin                                            ← universal symlink
3. ~/.agents/skills/<skill>/../..                                 ← Claude Code skill symlink
4. ~/.copilot/skills/<skill>/../..                               ← Codex skill path
5. ~/.opencode/grasp-it/grasp-it-plugin                          ← OpenCode path
6. ~/.pi/grasp-it/grasp-it-plugin                                ← Codex .pi variant
7. ~/grasp-it/grasp-it-plugin                                    ← direct clone
```

The first candidate with a valid `package.json` + `pnpm-workspace.yaml` wins.

## Version Upgrade Check

After initial resolution, the code compares the resolved plugin's version against the latest Claude cache version. If the cache is newer, it upgrades automatically:

```bash
PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json")
CACHE_VERSION=$(jq -r '.version' "$LATEST_CACHE/package.json")
if [ "$(printf '%s\n' "$CACHE_VERSION" "$PLUGIN_VERSION" | sort -V | tail -1)" = "$CACHE_VERSION" ]; then
  PLUGIN_ROOT="$LATEST_CACHE"
fi
```

This means **even on Codex**, if the Claude cache has a newer version, the plugin will use it. This is the correct behavior — the cache is always the freshest source of truth.

## Why the Stale Symlink Bug Happened

The bug in the bug report occurred because:

1. Claude Code's plugin cache at `~/.claude/plugins/cache/grasp-it/grasp-it/` was updated to v0.4.0 by `/plugin update`
2. But `~/.grasp-it-plugin` — a symlink to a local repo clone — still pointed to v0.2.0
3. Since `~/.grasp-it-plugin` appears earlier in the candidate list than the Claude cache (before the fix), v0.2.0 was selected
4. The stale symlink validation only checked for file existence, not version

The fix moves the Claude cache to **first position** in the candidate list and adds a version-comparison upgrade step.

## No Platform Detection

There is no `IS_CLAUDE` / `IS_CODEX` environment variable check. The plugin uses a pure priority loop — all known paths are tried in fixed order and the first valid one wins. This is intentional:

- Claude Code's cache always wins when present (correct behavior)
- Codex users without a Claude cache use `~/.grasp-it-plugin` or `~/.copilot/skills/`
- The universal symlink ensures any platform can work with a single consistent installation

## Platform-Specific Environment Variables

| Variable | Platform | Used For |
|----------|----------|----------|
| `$CLAUDE_PLUGIN_ROOT` | Claude Code | Hook context in `hooks.json` |
| `$HOME/.claude/plugins/cache/grasp-it/grasp-it` | Claude Code | Plugin cache base path |
| `$HOME/.agents/skills/<skill>` | Claude Code | Native skill install path |
| `$HOME/.copilot/skills/<skill>` | Codex | Skill install path |
| `$HOME/.opencode/grasp-it/grasp-it-plugin` | OpenCode | Plugin install path |
| `$HOME/.pi/grasp-it/grasp-it-plugin` | Codex variant | Plugin install path |

## Skills Affected

All skill files use the same resolution pattern:

- `skills/grasp/SKILL.md`
- `skills/grasp-domain/SKILL.md`
- `skills/grasp-diff/SKILL.md`
- `skills/grasp-explain/SKILL.md`
- `skills/grasp-interview/SKILL.md`
- `skills/grasp-chat/SKILL.md`

All were updated to put the Claude cache first and add version comparison.

## Diagnostic Output

Each skill now prints at startup:

```
[<skill>] Using plugin: /path/to/plugin (version: 0.4.0)
[<skill>] Using Neo4j database: grasp
```

This immediately reveals which plugin version and database is in use, making misconfigurations visible before any graph operations occur.