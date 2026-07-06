#!/usr/bin/env bash
# sync-to-cache.sh
#
# Copy the local grasp-it plugin into Claude Code's plugin cache.
# After copying, install production dependencies (including the optional
# neo4j-driver used by run-query.mjs).
#
# Required because `cp -R` of a pnpm-managed project does NOT bring a usable
# node_modules tree — pnpm uses symlinks into .pnpm/, and after the copy
# those symlinks point outside the cache and resolve to nothing. Running
# `pnpm install --prod` in the cache rebuilds a self-contained node_modules.
#
# Usage:
#   ./scripts/sync-to-cache.sh                # uses current package.json version
#   ./scripts/sync-to-cache.sh 0.13.7          # override target cache version
#   ./scripts/sync-to-cache.sh --skip-install  # copy only; you install deps yourself
#
# Both flags are accepted. After sync, restart Claude Code to pick up changes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_BASE="${GRASP_IT_CACHE:-$HOME/.claude/plugins/cache/grasp-it/grasp-it}"

SKIP_INSTALL=0
TARGET_VERSION=""

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --help|-h)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      if [ -z "$TARGET_VERSION" ]; then TARGET_VERSION="$arg"; fi
      ;;
  esac
done

if [ -z "$TARGET_VERSION" ]; then
  TARGET_VERSION="$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "")"
  if [ -z "$TARGET_VERSION" ] || [ "$TARGET_VERSION" = "null" ]; then
    echo "ERROR: could not read version from $PLUGIN_ROOT/package.json (jq missing?)" >&2
    exit 1
  fi
fi

CACHE_DIR="$CACHE_BASE/$TARGET_VERSION"

echo "→ Syncing plugin to cache"
echo "  Source:  $PLUGIN_ROOT"
echo "  Target:  $CACHE_DIR"

rm -rf "$CACHE_DIR"
mkdir -p "$CACHE_DIR"
cp -R "$PLUGIN_ROOT/." "$CACHE_DIR/"

# Preserve executable bit on hooks (cp -R keeps mode but verify).
if [ -d "$CACHE_DIR/hooks" ]; then
  find "$CACHE_DIR/hooks" -type f -name "*.sh" -exec chmod +x {} + 2>/dev/null || true
fi
chmod +x "$PLUGIN_ROOT/scripts/sync-to-cache.sh" 2>/dev/null || true

if [ "$SKIP_INSTALL" = "1" ]; then
  echo
  echo "✓ Copied. node_modules NOT installed (--skip-install)."
  echo "  Run: cd $CACHE_DIR && pnpm install --prod --frozen-lockfile --ignore-scripts"
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo
  echo "✓ Copied, but pnpm is not on PATH so node_modules was NOT installed."
  echo "  Install pnpm (https://pnpm.io) then run:"
  echo "    cd $CACHE_DIR && pnpm install --prod --frozen-lockfile --ignore-scripts"
  echo
  echo "  Alternatively, set GRASP_IT_NEO4J_CONNECTION_TYPE=cypher-shell in your env"
  echo "  and install cypher-shell separately — run-query.mjs will route through that."
  exit 0
fi

echo
echo "→ Installing production dependencies in cache"
cd "$CACHE_DIR"
pnpm install \
  --prod \
  --frozen-lockfile \
  --ignore-scripts \
  --reporter=silent 2>&1 | grep -vE '^(Done in|WARN  issues? while reading "/Users/[^/]+/\.npmrc")' || true

if [ ! -d "$CACHE_DIR/node_modules" ]; then
  echo "✗ pnpm install did not produce node_modules" >&2
  exit 1
fi

if [ ! -e "$CACHE_DIR/node_modules/neo4j-driver" ]; then
  echo "⚠  WARNING: neo4j-driver is not present in $CACHE_DIR/node_modules"
  echo "   run-query.mjs will fall back to cypher-shell."
  echo "   To force the driver backend: ensure optionalDependencies install succeeds"
  echo "   (check your pnpm config — neo4j-driver ships native bindings)."
fi

echo
echo "✓ Done. Restart Claude Code (or /reload-plugins) to pick up changes."
