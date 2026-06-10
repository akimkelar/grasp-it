#!/usr/bin/env bash
# Grasp-It installer (macOS / Linux)
#
# Usage:
#   ./install.sh                       Prompt for platform
#   ./install.sh <platform>            Install for <platform>
#   ./install.sh --update              Pull latest changes
#   ./install.sh --uninstall <plat>    Remove links for <plat>
#   ./install.sh --help
#
# Curl-pipe usage:
#   curl -fsSL https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/akimkelar/Grasp-It/main/install.sh | bash -s codex
#
# Environment:
#   UA_REPO_URL  Override clone URL (default: official GitHub repo)
#   UA_DIR       Override clone destination (default: $HOME/.grasp-it/repo)

set -euo pipefail

REPO_URL="${UA_REPO_URL:-https://github.com/akimkelar/Grasp-It.git}"
REPO_DIR="${UA_DIR:-$HOME/.grasp-it/repo}"
PLUGIN_LINK="$HOME/.grasp-it-plugin"

# Platform table — id|skills-target-dir|style
# style "per-skill": one symlink per skill into the target dir
# style "folder":    one symlink for the whole skills/ dir into the target,
#                    named "grasp-it"
platforms_table() {
  cat <<EOF
gemini|$HOME/.agents/skills|per-skill
codex|$HOME/.agents/skills|per-skill
opencode|$HOME/.agents/skills|per-skill
pi|$HOME/.agents/skills|per-skill
openclaw|$HOME/.openclaw/skills|folder
antigravity|$HOME/.gemini/antigravity/skills|folder
vibe|$HOME/.vibe/skills|per-skill
vscode|$HOME/.copilot/skills|per-skill
hermes|$HOME/.hermes/skills|folder
cline|$HOME/.cline/skills|folder
kimi|$HOME/.kimi/skills|folder
trae|$HOME/.trae/skills|per-skill
claude|$HOME/.claude/plugins/cache|claude
EOF
}

platform_ids() { platforms_table | cut -d'|' -f1; }

resolve_platform() {
  local id="$1"
  local row
  row="$(platforms_table | awk -F'|' -v id="$id" '$1==id {print; exit}')"
  if [[ -z "$row" ]]; then
    printf 'Unknown platform: %s\n' "$id" >&2
    printf 'Supported: %s\n' "$(platform_ids | tr '\n' ' ')" >&2
    exit 1
  fi
  printf '%s\n' "$row"
}

prompt_platform() {
  local ids=()
  while IFS= read -r id; do ids+=("$id"); done < <(platform_ids)

  printf 'Which platform are you installing for?\n' >&2
  local i=1
  for id in "${ids[@]}"; do
    printf '  %d) %s\n' "$i" "$id" >&2
    i=$((i+1))
  done
  printf 'Choose [1-%d]: ' "${#ids[@]}" >&2

  local choice=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -r choice <&3 || true
    exec 3<&-
  else
    read -r choice || true
  fi
  if [[ -z "$choice" ]]; then
    printf '\nNo input received. Pass the platform as an argument instead, e.g.:\n' >&2
    printf '  install.sh codex\n' >&2
    exit 1
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#ids[@]} )); then
    printf 'Invalid choice: %s\n' "$choice" >&2
    exit 1
  fi
  printf '%s\n' "${ids[$((choice-1))]}"
}

clone_or_update() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    printf -- '→ Updating existing checkout at %s\n' "$REPO_DIR"
    git -C "$REPO_DIR" fetch origin
    git -C "$REPO_DIR" reset --hard origin/main
  else
    printf -- '→ Cloning %s → %s\n' "$REPO_URL" "$REPO_DIR"
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone "$REPO_URL" "$REPO_DIR"
  fi
}

build_plugin() {
  # Pre-build core/dist so skill scripts don't need pnpm at runtime.
  # This runs once after clone/update; subsequent skill invocations use the cached dist/.
  local core_dist="$REPO_DIR/grasp-it-plugin/packages/core/dist"
  if [[ ! -f "$core_dist/index.js" ]]; then
    printf -- '→ Building @grasp-it/core (pre-computed for skill runtime)\n'
    if command -v pnpm >/dev/null 2>&1; then
      (cd "$REPO_DIR" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @grasp-it/core build)
    else
      printf -- '  warning: pnpm not found — skipping build. Skills may need Node.js ≥ 22 and pnpm ≥ 10.\n'
    fi
  fi
}

install_claude_plugin() {
  # Installs the plugin into Claude Code's plugin cache, or sets up the
  # plugin files for manual installation if Claude Code is not present.
  local plugin_src="$REPO_DIR/grasp-it-plugin"
  local claude_cache_base="$HOME/.claude/plugins/cache"
  local plugin_name="grasp-it"
  local cache_target

  # Detect Claude Code version from the plugin's package.json
  local plugin_version
  plugin_version="$(cat "$plugin_src/package.json" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/".*//')"
  if [[ -z "$plugin_version" ]]; then
    plugin_version="0.1.0"
  fi

  cache_target="$claude_cache_base/$plugin_name/$plugin_name/$plugin_version"

  if command -v claude >/dev/null 2>&1 && [[ -d "$HOME/.claude" ]]; then
    printf -- '→ Installing Grasp-It plugin into Claude Code cache\n'
    mkdir -p "$claude_cache_base/$plugin_name/$plugin_name"
    rm -rf "$cache_target"
    cp -R "$plugin_src" "$cache_target"
    printf -- '  ✓ Plugin installed to %s\n' "$cache_target"

    # Detect whether an older version is already active vs. first install.
    local already_active
    already_active="$(claude plugin list 2>/dev/null | grep -q "^grasp-it" && echo yes || echo no)"
    if [[ "$already_active" == "yes" ]]; then
      printf '\n  An older version is active. To upgrade, restart Claude Code or run:\n'
      printf '    /plugin update grasp-it\n'
    else
      printf '\n  Restart Claude Code to pick up the plugin, or run:\n'
      printf '    /plugin marketplace add akimkelar/Grasp-It\n'
      printf '    /plugin install grasp-it\n'
    fi
  else
    printf -- '→ Claude Code not detected — setting up plugin files for manual installation\n'
    build_plugin
    link_plugin_root
    printf '\n  Claude Code not found on this system.\n'
    printf '  To use Grasp-It with Claude Code:\n'
    printf '    1. Install Claude Code from https://docs.anthropic.com/en/docs/claude-code/\n'
    printf '    2. Restart your terminal\n'
    printf '    3. Run: /plugin marketplace add akimkelar/Grasp-It && /plugin install grasp-it\n'
  fi
}

skills_root() { printf '%s\n' "$REPO_DIR/grasp-it-plugin/skills"; }

list_skills() {
  local root
  root="$(skills_root)"
  if [[ ! -d "$root" ]]; then
    printf 'Skills directory not found: %s\n' "$root" >&2
    exit 1
  fi
  local d
  for d in "$root"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

link_skills() {
  local target="$1" style="$2"
  local root
  root="$(skills_root)"
  mkdir -p "$target"
  case "$style" in
    per-skill)
      local skill
      while IFS= read -r skill; do
        ln -sfn "$root/$skill" "$target/$skill"
        printf '  ✓ %s → %s\n' "$target/$skill" "$root/$skill"
      done < <(list_skills)
      ;;
    folder)
      ln -sfn "$root" "$target/grasp-it"
      printf '  ✓ %s → %s\n' "$target/grasp-it" "$root"
      ;;
    claude)
      # Claude Code uses plugin cache installation instead of skill symlinks.
      # Handled by install_claude_plugin() in cmd_install.
      ;;
    *)
      printf 'Unknown style: %s\n' "$style" >&2
      exit 1
      ;;
  esac
}

unlink_skills() {
  local target="$1" style="$2"
  [[ -d "$target" ]] || return 0
  case "$style" in
    per-skill)
      if [[ -d "$(skills_root)" ]]; then
        local skill
        while IFS= read -r skill; do
          [[ -L "$target/$skill" ]] && rm -f "$target/$skill"
        done < <(list_skills)
      else
        # Checkout is gone — scan the target dir for stale links pointing into
        # our plugin tree so we can still clean up.
        local link resolved
        for link in "$target"/*; do
          [[ -L "$link" ]] || continue
          resolved="$(readlink "$link" 2>/dev/null || true)"
          [[ "$resolved" == *"/grasp-it-plugin/skills/"* ]] || continue
          rm -f "$link"
        done
      fi
      ;;
    folder)
      [[ -L "$target/grasp-it" ]] && rm -f "$target/grasp-it"
      ;;
    claude)
      # Remove the plugin from Claude Code's cache.
      local plugin_version
      plugin_version="$(cat "$REPO_DIR/grasp-it-plugin/package.json" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/".*//')"
      if [[ -z "$plugin_version" ]]; then
        plugin_version="0.1.0"
      fi
      local cache_path="$HOME/.claude/plugins/cache/grasp-it/grasp-it/$plugin_version"
      [[ -d "$cache_path" ]] && rm -rf "$cache_path"
      ;;
  esac
}

link_plugin_root() {
  if [[ -L "$PLUGIN_LINK" || -e "$PLUGIN_LINK" ]]; then
    printf '  • %s already exists, leaving as-is\n' "$PLUGIN_LINK"
  else
    ln -s "$REPO_DIR/grasp-it-plugin" "$PLUGIN_LINK"
    printf '  ✓ %s → %s\n' "$PLUGIN_LINK" "$REPO_DIR/grasp-it-plugin"
  fi
}

cmd_install() {
  local id="$1"
  local row target style
  row="$(resolve_platform "$id")"
  target="$(printf '%s\n' "$row" | cut -d'|' -f2)"
  style="$(printf '%s\n' "$row" | cut -d'|' -f3)"

  clone_or_update

  if [[ "$id" == "claude" ]]; then
    install_claude_plugin
  else
    build_plugin
    printf -- '→ Linking skills for %s (%s → %s)\n' "$id" "$style" "$target"
    link_skills "$target" "$style"
    printf -- '→ Linking universal plugin root\n'
    link_plugin_root

    printf '\n✓ Installed Grasp-It for %s\n' "$id"
    printf '  Restart your CLI or IDE to pick up the skills.\n'
    if [[ "$id" == "vscode" ]]; then
      printf '\n  Tip: VS Code can also auto-discover the plugin by opening this repo\n'
      printf '       directly (it reads .copilot-plugin/plugin.json), no symlinks needed.\n'
    fi
  fi
}

cmd_uninstall() {
  local id="$1"
  local row target style
  row="$(resolve_platform "$id")"
  target="$(printf '%s\n' "$row" | cut -d'|' -f2)"
  style="$(printf '%s\n' "$row" | cut -d'|' -f3)"

  if [[ "$id" == "claude" ]]; then
    printf -- '→ Removing Grasp-It plugin from Claude Code cache\n'
  else
    printf -- '→ Removing skill links for %s\n' "$id"
  fi
  unlink_skills "$target" "$style"
  if [[ -L "$PLUGIN_LINK" ]]; then
    rm -f "$PLUGIN_LINK"
    printf '  ✓ removed %s\n' "$PLUGIN_LINK"
  fi
  if [[ -d "$REPO_DIR" ]]; then
    printf '\nThe checkout at %s was kept (other platforms may still use it).\n' "$REPO_DIR"
    printf 'To remove it: rm -rf "%s"\n' "$REPO_DIR"
  fi
}

cmd_update() {
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    printf 'No installation found at %s. Run install first.\n' "$REPO_DIR" >&2
    exit 1
  fi
  git -C "$REPO_DIR" pull --ff-only
  printf '✓ Updated.\n'
}

usage() {
  cat <<USAGE
Grasp-It installer

Usage:
  install.sh [<platform>]            Install for <platform> (or prompt if omitted)
  install.sh --update                Pull latest changes (skills update through symlinks)
  install.sh --uninstall <platform>  Remove links for <platform>
  install.sh --help

Supported platforms:
$(platform_ids | sed 's/^/  - /')

Environment:
  UA_REPO_URL  Override clone URL (default: official repo)
  UA_DIR       Override clone destination (default: \$HOME/.grasp-it/repo)
USAGE
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      ;;
    --update)
      cmd_update
      ;;
    --uninstall)
      shift
      if [[ -z "${1:-}" ]]; then
        printf '%s\n' '--uninstall requires a platform argument' >&2
        usage >&2
        exit 1
      fi
      cmd_uninstall "$1"
      ;;
    "")
      local id
      id="$(prompt_platform)"
      cmd_install "$id"
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      cmd_install "$1"
      ;;
  esac
}

main "$@"
