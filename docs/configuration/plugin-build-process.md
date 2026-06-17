# Building and Publishing a New Plugin Version

for the information about supporting the plugin for different platforms, read docs/configuration/plugin-platform-resolution.md

## Version Control

The plugin version is controlled by **three files** that must be kept in sync:

| File | Version | Notes |
|------|---------|-------|
| `grasp-it-plugin/.claude-plugin/plugin.json` | `"version"` | **Primary** - what Claude Code checks for updates |
| `grasp-it-plugin/package.json` | `"version"` | Skill package version |
| `grasp-it-plugin/packages/core/package.json` | `"version"` | Core package version |

All three must be updated together. Claude Code's `/plugin update` command reads `plugin.json`, not `package.json`.

## Build Steps

### 1. Ensure Node.js v18+ is available

```bash
source ~/.nvm/nvm.sh
nvm use node
node --version  # should be v18+
```

### 2. Bump version in all three files

```bash
# Edit these three files:
grasp-it-plugin/.claude-plugin/plugin.json
grasp-it-plugin/package.json
grasp-it-plugin/packages/core/package.json
```

Set all versions to the same value (e.g., `0.2.0` → `0.3.0`).

### 3. Build the packages

```bash
# From repo root:
source ~/.nvm/nvm.sh && nvm use node

# Build core package
pnpm --filter @grasp-it/core build

# Build skill package
pnpm --filter @grasp-it/skill build
```

Both must succeed with no TypeScript errors.

### 4. Run tests

```bash
NEO4J_URI=neo4j://127.0.0.1:7687 \
NEO4J_DATABASE=grasp \
NEO4J_USERNAME=neo4j \
NEO4J_PASSWORD=testneo4j \
pnpm test
```

Expected: 325+ tests pass. The "no Neo4j config" failures are pre-existing and expected when env vars are set. The compute-batches tests may show Object.Is equality errors on darwin/arm64 — these are pre-existing and unrelated to the build.

### 5. Commit and push

```bash
git add -A
git commit -m "chore: bump version to X.Y.Z"
git push
```

## Publishing

After pushing, Claude Code's `/plugin update` will detect the new version if:
- `plugin.json` version is higher than the cached version
- The changes are on the default branch (main)

For the update to be visible to users, ensure the repo is properly set up in the Claude Code plugin marketplace.

## Quick Reference

```bash
# Full build + test + commit
source ~/.nvm/nvm.sh && nvm use node
pnpm --filter @grasp-it/core build && pnpm --filter @grasp-it/skill build
NEO4J_URI=neo4j://127.0.0.1:7687 NEO4J_DATABASE=grasp NEO4J_USERNAME=neo4j NEO4J_PASSWORD=testneo4j pnpm test  # 325+ tests
git add -A && git commit -m "release: v0.2.0" && git push
```

## Troubleshooting

**`pnpm: command not found` or Node version error:**
```bash
source ~/.nvm/nvm.sh && nvm use node
```

**Build fails with TypeScript errors:**
Check that `session: null` is `session: undefined` in test mocks, and that type casts use `as any` where needed.

**Tests fail with JSON parse errors:**
The 3 "no Neo4j config" test failures are expected when `NEO4J_*` env vars are set. These tests verify behavior without any Neo4j configuration.
