#!/usr/bin/env bash
# resolve-plugin-root.sh
#
# Shared path resolver for grasp-* skills. Sources paths that the other skills
# rely on: PROJECT_ROOT, PLUGIN_ROOT, GRASP_SKILL_DIR.
#
# Usage in a SKILL.md (this is the canonical form — copy/paste, do NOT inline
# a duplicate block):
#
#   PROJECT_ROOT="${PWD}"
#   # shellcheck source=/dev/null
#   source "<plugin>/skills/_lib/resolve-plugin-root.sh"
#
#   # Now use:
#   node "$GRASP_SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "..."
#
# The resolver probes these candidate locations in order, picking the first
# one that looks like a real grasp-it plugin (has package.json AND
# pnpm-workspace.yaml):
#
#   1. LATEST cache version under ~/.claude/plugins/cache/grasp-it/grasp-it/
#   2. ~/.grasp-it-plugin (user dev install)
#   3. Self-relative: where this SKILL.md lives, walking up to plugin root
#   4. Copilot skill install location
#   5. ~/.opencode/grasp-it/grasp-it-plugin
#   6. ~/.pi/grasp-it/grasp-it-plugin
#   7. ~/grasp-it/grasp-it-plugin
#
# Cache is preferred over dev plugin when the cache version is newer (so
# marketplace upgrades win over an older local checkout).
#
# IMPORTANT: do NOT replace `source` with `dirname "$0"` based path math in
# SKILL.md files. $0 in Claude Code's bash tool is the shell name, not the
# SKILL.md path — `dirname "$0"` returns "." and breaks relative-path
# resolution. See git history for the grasp-search / grasp-gaps SKILL.md
# path-bug fix.

set -u

# ── PROJECT_ROOT ──────────────────────────────────────────────────────────────
PROJECT_ROOT="${PROJECT_ROOT:-$PWD}"

# Resolve to main worktree root if we're inside a linked worktree.
COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null || true)
GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null || true)
if [ -n "${COMMON_DIR:-}" ] && [ -n "${GIT_DIR:-}" ]; then
  COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P || true)
  GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P || true)
  if [ -n "${COMMON_ABS:-}" ] && [ "${COMMON_ABS:-}" != "${GIT_ABS:-}" ]; then
    MAIN_ROOT=$(dirname "$COMMON_ABS")
    if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
      PROJECT_ROOT="$MAIN_ROOT"
    fi
  fi
fi

# ── PLUGIN_ROOT ───────────────────────────────────────────────────────────────
SKILL_REAL=$(realpath ~/.agents/skills/grasp-diff 2>/dev/null || readlink -f ~/.agents/skills/grasp-diff 2>/dev/null || echo "")
SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp-diff 2>/dev/null || readlink -f ~/.copilot/skills/grasp-diff 2>/dev/null || echo "")
COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

CACHE_BASE="$HOME/.claude/plugins/cache/grasp-it/grasp-it"
LATEST_CACHE=$(ls -d "$CACHE_BASE"/*/ 2>/dev/null | sort -V | tail -1 | sed 's|/$||')

PLUGIN_ROOT=""
for candidate in \
  "$LATEST_CACHE" \
  "$HOME/.grasp-it-plugin" \
  "$SELF_RELATIVE" \
  "$COPILOT_SELF_RELATIVE" \
  "$HOME/.opencode/grasp-it/grasp-it-plugin" \
  "$HOME/.pi/grasp-it/grasp-it-plugin" \
  "$HOME/grasp-it/grasp-it-plugin"; do
  if [ -n "$candidate" ] && [ -f "$candidate/package.json" ] && [ -f "$candidate/pnpm-workspace.yaml" ]; then
    PLUGIN_ROOT="$candidate"
    break
  fi
done

# Prefer cache over dev plugin when cache is newer.
if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/package.json" ]; then
  PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "0")
  CACHE_VERSION=$(jq -r '.version' "$LATEST_CACHE/package.json" 2>/dev/null || echo "0")
  if [ "$(printf '%s\n' "$CACHE_VERSION" "$PLUGIN_VERSION" | sort -V | tail -1)" = "$CACHE_VERSION" ] \
     && [ "$CACHE_VERSION" != "$PLUGIN_VERSION" ]; then
    PLUGIN_ROOT="$LATEST_CACHE"
  fi
fi

export PROJECT_ROOT
export PLUGIN_ROOT
export GRASP_SKILL_DIR="$PLUGIN_ROOT/skills/grasp"
