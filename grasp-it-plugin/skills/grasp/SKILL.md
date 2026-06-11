---
name: grasp
description: Analyze a codebase to produce an interactive knowledge graph for understanding architecture, components, and relationships
argument-hint: ["[path] [--full|--auto-update|--no-auto-update|--review|--language <lang>]"]
---

# /grasp

Analyze the current codebase and produce a knowledge graph stored in Neo4j. The graph powers the interactive dashboard for exploring the project's architecture.

## Options

- `$ARGUMENTS` may contain:
  - `--full` — Force a full rebuild, ignoring any existing graph
  - `--auto-update` — Enable automatic graph updates on commit (writes `autoUpdate: true` to `.grasp-it/config.json`)
  - `--no-auto-update` — Disable automatic graph updates (writes `autoUpdate: false` to `.grasp-it/config.json`)
  - `--review` — Run full LLM graph-reviewer instead of inline deterministic validation
  - `--language <lang>` — Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in the specified language. Accepts ISO 639-1 codes (`zh`, `ja`, `ko`, `en`, `es`, `fr`, `de`, etc.) or friendly names (`chinese`, `japanese`, `korean`, `english`, `spanish`, etc.). Locale variants supported: `zh-TW`, `zh-HK`, etc. Defaults to `en` (English). Stores preference in `.grasp-it/config.json` for consistency across incremental updates.
  - `--scope <name>` — Label the analysis scope (stored in project metadata). Does not change the decision-logic branch — an existing graph with `--scope` still follows the incremental-vs-full decision table.
  - `--files <comma-list>` — Override file discovery to analyze only the listed paths (comma-separated). Does not change the decision-logic branch — a `--files` run with an existing graph still follows the incremental-vs-full decision table.
  - A directory path (e.g. `/path/to/repo` or `../other-project`) — Analyze the given directory instead of the current working directory

---

## Progress Reporting

Throughout execution, report progress to the user at each phase transition and during batch processing. This keeps users informed on large codebases where analysis can take a long time.

- **Phase transitions:** At the start of each phase, print a status line:
  > `[Phase N/7] <phase name>...`
  >
  > Example: `[Phase 2/7] Analyzing files (12 batches)...`

- **Batch progress:** During Phase 2, report each batch with its index and total:
  > `Analyzing batch X/N (files: foo.ts, bar.ts, ...)` (list up to 3 filenames, then `...` if more)

- **Phase completion:** When a phase finishes, briefly confirm:
  > `Phase N complete. <one-line summary of result>`
  >
  > Example: `Phase 1 complete. Found 247 files across 3 languages.`

---

## Phase 0 — Pre-flight

Determine whether to run a full analysis or incremental update.

1. **Resolve `PROJECT_ROOT`:**
   - Parse `$ARGUMENTS` for a non-flag token (any argument that does not start with `--`). If found, treat it as the target directory path.
     - If the path is relative, resolve it against the current working directory.
     - Verify the resolved path exists and is a directory (run `test -d <path>`). If it does not exist or is not a directory, report an error to the user and **STOP**.
     - Set `PROJECT_ROOT` to the resolved absolute path.
   - If no directory path argument is found, set `PROJECT_ROOT` to the current working directory.
   - **Worktree redirect.** If `PROJECT_ROOT` is inside a git worktree (not the main checkout), redirect output to the main repository root. Worktrees managed by Claude Code are ephemeral — `.grasp-it/` written there is destroyed when the session ends, taking the knowledge graph with it (issue #133). Detect a worktree by comparing `git rev-parse --git-dir` against `git rev-parse --git-common-dir`; in a normal checkout or submodule they resolve to the same path, in a worktree they differ and the parent of `--git-common-dir` is the main repo root.

     ```bash
     COMMON_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null)
     GIT_DIR=$(git -C "$PROJECT_ROOT" rev-parse --git-dir 2>/dev/null)
     if [ -n "$COMMON_DIR" ] && [ -n "$GIT_DIR" ]; then
       COMMON_ABS=$(cd "$PROJECT_ROOT" && cd "$COMMON_DIR" 2>/dev/null && pwd -P)
       GIT_ABS=$(cd "$PROJECT_ROOT" && cd "$GIT_DIR" 2>/dev/null && pwd -P)
       if [ -n "$COMMON_ABS" ] && [ "$COMMON_ABS" != "$GIT_ABS" ]; then
         MAIN_ROOT=$(dirname "$COMMON_ABS")
         if [ -d "$MAIN_ROOT" ] && [ "${UNDERSTAND_NO_WORKTREE_REDIRECT:-0}" != "1" ]; then
           echo "[grasp-it] Detected git worktree at $PROJECT_ROOT"
           echo "[grasp-it] Redirecting output to main repo root: $MAIN_ROOT"
           echo "[grasp-it] (Set UNDERSTAND_NO_WORKTREE_REDIRECT=1 to keep PROJECT_ROOT as the worktree.)"
           PROJECT_ROOT="$MAIN_ROOT"
         fi
       fi
     fi
     ```

     Set `UNDERSTAND_NO_WORKTREE_REDIRECT=1` if you intentionally want a per-worktree graph (rare — most users want the redirect).
1.5. **Ensure the plugin is built.** Later phases invoke Node scripts that import `@grasp-it/core`. On a fresh install `packages/core/dist/` does not exist yet — build once.

   **Important:** do **not** assume the plugin root is simply two directories above the skill path string. In many installations `~/.agents/skills/grasp` is a symlink into the real plugin checkout. Prefer runtime-provided plugin roots first (for Claude), then fall back to universal symlinks, skill symlink resolution, and common clone-based install paths.

   Resolve the plugin root like this:

   ```bash
   SKILL_REAL=$(realpath ~/.agents/skills/grasp 2>/dev/null || readlink -f ~/.agents/skills/grasp 2>/dev/null || echo "")
   SELF_RELATIVE=$([ -n "$SKILL_REAL" ] && cd "$SKILL_REAL/../.." 2>/dev/null && pwd || echo "")
   COPILOT_SKILL_REAL=$(realpath ~/.copilot/skills/grasp 2>/dev/null || readlink -f ~/.copilot/skills/grasp 2>/dev/null || echo "")
   COPILOT_SELF_RELATIVE=$([ -n "$COPILOT_SKILL_REAL" ] && cd "$COPILOT_SKILL_REAL/../.." 2>/dev/null && pwd || echo "")

   # Probe Claude plugin cache first — it always has the freshly-updated version.
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

   if [ -z "$PLUGIN_ROOT" ]; then
     echo "Error: Cannot find the grasp-it plugin root."
     echo "Checked:"
     echo "  - ${LATEST_CACHE:-<no Claude cache found>}"
     echo "  - $HOME/.grasp-it-plugin"
     echo "  - ${SELF_RELATIVE:-<unresolved path derived from ~/.agents/skills/grasp>}"
     echo "  - ${COPILOT_SELF_RELATIVE:-<unresolved path derived from ~/.copilot/skills/grasp>}"
     echo "  - $HOME/.opencode/grasp-it/grasp-it-plugin"
     echo "  - $HOME/.pi/grasp-it/grasp-it-plugin"
     echo "  - $HOME/grasp-it/grasp-it-plugin"
     echo "Make sure the plugin is installed correctly."
     exit 1
   fi

   # Upgrade to newer cache version if one exists and is newer than resolved PLUGIN_ROOT.
   if [ -n "$LATEST_CACHE" ] && [ -f "$LATEST_CACHE/package.json" ]; then
     PLUGIN_VERSION=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "0")
     CACHE_VERSION=$(jq -r '.version' "$LATEST_CACHE/package.json" 2>/dev/null || echo "0")
     if [ "$(printf '%s\n' "$CACHE_VERSION" "$PLUGIN_VERSION" | sort -V | tail -1)" = "$CACHE_VERSION" ] \
        && [ "$CACHE_VERSION" != "$PLUGIN_VERSION" ]; then
       echo "[grasp] NOTE: Upgrading from $PLUGIN_VERSION to cache version $CACHE_VERSION"
       PLUGIN_ROOT="$LATEST_CACHE"
     fi
   fi

   echo "[grasp] Using plugin: $PLUGIN_ROOT (version: $(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "unknown"))"

   if [ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]; then
     cd "$PLUGIN_ROOT" && (pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm --filter @grasp-it/core build
   fi
   ```

   If `pnpm` is missing, report to the user: "Install Node.js ≥ 22 and pnpm ≥ 10, then re-run `/grasp`."

1.6. **Neo4j configuration check:**
   Check if Neo4j credentials are available by looking for a `.env` file at the project root:
   ```bash
   if [ -f "$PROJECT_ROOT/.env" ] && grep -q "NEO4J_URI" "$PROJECT_ROOT/.env"; then
     echo "[grasp-it] Neo4j configuration found in $PROJECT_ROOT/.env"
   else
     # Check global config
     if [ -f "$HOME/.grasp-it/neo4j.env" ] && grep -q "NEO4J_URI" "$HOME/.grasp-it/neo4j.env"; then
       echo "[grasp-it] Neo4j configuration found in global config"
     else
       # Check environment variables
       if [ -n "$NEO4J_URI" ] && [ -n "$NEO4J_USERNAME" ]; then
         echo "[grasp-it] Neo4j configuration found in environment"
       else
         echo "[grasp-it] No Neo4j configuration found"
       fi
     fi
   fi
   ```
   Load the configuration for use by subsequent phases:
   ```bash
   if [ -f "$PROJECT_ROOT/.env" ]; then
     set -a
     source "$PROJECT_ROOT/.env" 2>/dev/null
     set +a
   elif [ -f "$HOME/.grasp-it/neo4j.env" ]; then
     set -a
     source "$HOME/.grasp-it/neo4j.env" 2>/dev/null
     set +a
   fi
   ```
   Neo4j configuration is used by:
   - `/grasp-search` — queries the knowledge graph
   - `/grasp-gaps` — updates the knowledge graph
   - `/grasp-domain` — may write to the knowledge graph

 1.6.5. **First-use guided setup (no config):**
   If no Neo4j configuration is found (no `.env`, no env vars, no global config), prompt the user
   interactively to collect credentials and write them to `$PROJECT_ROOT/.env`. This step is
   skipped entirely if any config source already exists.

   > **Prompting via LLM interface:** The prompts shown below use `**Ask user:**` to denote an
   > interactive question surfaced to the user via the model's message interface — the model
   > asks the question and waits for the user's reply, then continues. This works in Claude Code
   > and Codex contexts.

   **First, detect whether any config exists** (checking in order env vars → project `.env` →
   global `~/.grasp-it/neo4j.env`):
   ```bash
   if [ -n "$NEO4J_URI" ] && [ -n "$NEO4J_USERNAME" ]; then
     NEO4J_CONFIG_FOUND=1
   elif [ -f "$PROJECT_ROOT/.env" ] && grep -q "NEO4J_URI" "$PROJECT_ROOT/.env"; then
     NEO4J_CONFIG_FOUND=1
   elif [ -f "$HOME/.grasp-it/neo4j.env" ] && grep -q "NEO4J_URI" "$HOME/.grasp-it/neo4j.env"; then
     NEO4J_CONFIG_FOUND=1
   else
     NEO4J_CONFIG_FOUND=0
   fi
   ```

   **If no config found (`NEO4J_CONFIG_FOUND=0`), run the guided setup Node.js script:**
   The skill directory contains a `first-use-setup.mjs` script that:
   1. Prompts for connection type (default: `1` = driver), URI (default: `bolt://localhost:7687`),
      database name (default: `neo4j`), username (default: `neo4j`), and password
   2. Calls `saveConfig()` to write `$PROJECT_ROOT/.env` (which also runs `ensureEnvInGitignore()`)
   3. Asks whether to also save globally to `~/.grasp-it/neo4j.env` (default: yes); if yes, calls `saveGlobalConfig()`
   4. Loads env vars from `.env` so subsequent phases have the credentials

   Write the setup script to `$PROJECT_ROOT/.grasp-it/tmp/first-use-setup.mjs`:
   ```javascript
   #!/usr/bin/env node
   import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
   import { join } from 'node:path';
   import { createInterface } from 'readline';
   import { fileURLToPath } from 'node:url';
   import { dirname } from 'node:path';
   import { homedir } from 'node:os';

   const __dirname = dirname(fileURLToPath(import.meta.url));

   const ENV_VARS = {
     URI: 'NEO4J_URI',
     DATABASE: 'NEO4J_DATABASE',
     USERNAME: 'NEO4J_USERNAME',
     PASSWORD: 'NEO4J_PASSWORD',
     CONNECTION_TYPE: 'NEO4J_CONNECTION_TYPE',
   };
   const DEFAULTS = {
     DATABASE: 'neo4j',
     CONNECTION_TYPE: 'driver',
     URI: 'bolt://localhost:7687',
     USERNAME: 'neo4j',
   };
   const SETUP_PROMPTS = {
     ROLE: `What is your role?
   1. Developer — I have the codebase locally and want to build/update the knowledge graph
   2. Analyst/Non-developer — I only want to query the existing graph (no local codebase)
   Enter your choice (1 or 2, default 1):`,
     CONNECTION_TYPE: `Which connection type would you like to use?
   1. Driver (default) - Direct connection using neo4j-driver.
   2. cypher-shell - Use Neo4j CLI tool.
   3. MCP (Model Context Protocol) - Connect via neo4j-mcp server.
   Enter your choice (1, 2, or 3) or press Enter for default (1 - Driver):`,
     NEO4J_URI: `Enter your Neo4j connection URI:
   - Local: bolt://localhost:7687
   - Neo4j Aura: neo4j+s://xxxxx.databases.neo4j.io
   Press Enter for default (bolt://localhost:7687):`,
     NEO4J_DATABASE: `Enter the database name (default: neo4j):`,
     NEO4J_USERNAME: `Enter your Neo4j username (default: neo4j):`,
     NEO4J_PASSWORD: `Enter your Neo4j password:`,
   };

   function serializeEnvFile(config) {
     return [
       '# Neo4j Configuration for grasp-it',
       '# Generated by grasp-it plugin',
       '# Do not commit this file to version control',
       '',
       `${ENV_VARS.URI}=${config.uri}`,
       `${ENV_VARS.DATABASE}=${config.database}`,
       `${ENV_VARS.USERNAME}=${config.username}`,
       `${ENV_VARS.PASSWORD}=${config.password}`,
       `${ENV_VARS.CONNECTION_TYPE}=${config.connectionType}`,
       '',
     ].join('\n');
   }

   function ensureEnvInGitignore(projectRoot) {
     const gitignorePath = join(projectRoot, '.gitignore');
     const entry = '.env';
     try {
       const content = readFileSync(gitignorePath, 'utf-8');
       const lines = content.split('\n').map(l => l.trim());
       if (lines.includes(entry)) return;
       writeFileSync(gitignorePath, content + '\n# Added by grasp-it — keep Neo4j credentials out of version control\n' + entry + '\n', 'utf-8');
     } catch {
       writeFileSync(gitignorePath, '# Added by grasp-it — keep Neo4j credentials out of version control\n' + entry + '\n', 'utf-8');
     }
   }

   function saveConfig(projectRoot, config) {
     const filePath = join(projectRoot, '.env');
     const content = serializeEnvFile(config);
     writeFileSync(filePath, content, 'utf-8');
     ensureEnvInGitignore(projectRoot);
   }

   function saveGlobalConfig(config) {
     const globalDir = join(homedir(), '.grasp-it');
     mkdirSync(globalDir, { recursive: true });
     const filePath = join(globalDir, 'neo4j.env');
     const content = serializeEnvFile(config);
     writeFileSync(filePath, content, 'utf-8');
   }

   function saveGlobalAppConfig(role) {
     const configDir = join(homedir(), '.grasp-it');
     const configPath = join(configDir, 'config.json');
     let existing = {};
     try {
       existing = JSON.parse(readFileSync(configPath, 'utf-8'));
     } catch {
       // file doesn't exist yet or is invalid — start fresh
     }
     mkdirSync(configDir, { recursive: true });
     writeFileSync(configPath, JSON.stringify({ ...existing, role }, null, 2) + '\n', 'utf-8');
   }

   function ask(question) {
     return new Promise(resolve => {
       const rl = createInterface({ input: process.stdin, output: process.stdout });
       rl.question(question, answer => { rl.close(); resolve(answer); });
     });
   }

   async function main() {
     const projectRoot = process.argv[2];
     console.log('\n[grasp-it] Welcome! Let\'s get you set up.\n');

     // Step 1: Determine role — this is the most fundamental choice
     const roleAnswer = await ask(SETUP_PROMPTS.ROLE);
     const role = roleAnswer.trim() === '2' ? 'non-developer' : 'developer';

     // Step 2: Collect Neo4j credentials (both roles need them to connect to the graph)
     console.log('\n[grasp-it] Now let\'s configure your Neo4j connection.\n');

     let connType = DEFAULTS.CONNECTION_TYPE;
     const typeAnswer = await ask(SETUP_PROMPTS.CONNECTION_TYPE);
     if (typeAnswer.trim() === '2') connType = 'cypher-shell';
     else if (typeAnswer.trim() === '3') connType = 'mcp';

     let uri = DEFAULTS.URI;
     const uriAnswer = await ask(SETUP_PROMPTS.NEO4J_URI);
     if (uriAnswer.trim()) uri = uriAnswer.trim();

     const dbAnswer = await ask(SETUP_PROMPTS.NEO4J_DATABASE);
     const database = dbAnswer.trim() || DEFAULTS.DATABASE;

     let username = DEFAULTS.USERNAME;
     const userAnswer = await ask(SETUP_PROMPTS.NEO4J_USERNAME);
     if (userAnswer.trim()) username = userAnswer.trim();

     const password = await ask(SETUP_PROMPTS.NEO4J_PASSWORD);

     const config = { uri, database, username, password, connectionType: connType };
     saveConfig(projectRoot, config);
     saveGlobalAppConfig(role);

     const globalAnswer = await ask('\nSave these credentials globally for all projects? (y/n, default y): ');
     const saveGlobal = globalAnswer.trim().toLowerCase() !== 'n';
     if (saveGlobal) {
       saveGlobalConfig(config);
     }

     // Load the written .env into process.env so bash can source it
     const envPath = join(projectRoot, '.env');
     const content = readFileSync(envPath, 'utf-8');
     content.split('\n').forEach(line => {
       const trimmed = line.trim();
       if (!trimmed || trimmed.startsWith('#')) return;
       const eqIndex = trimmed.indexOf('=');
       if (eqIndex > 0) {
         const key = trimmed.slice(0, eqIndex).trim();
         const value = trimmed.slice(eqIndex + 1).trim();
         process.env[key] = value;
       }
     });

     console.log('\n[grasp-it] Neo4j credentials saved to .env');
     console.log('[grasp-it] Added .env to .gitignore');
     if (saveGlobal) {
       console.log('[grasp-it] Neo4j credentials also saved globally to ~/.grasp-it/neo4j.env');
     }
     console.log(`[grasp-it] Role saved to ~/.grasp-it/config.json: ${role}`);

     if (role === 'non-developer') {
       console.log('\n[grasp-it] You are set up for graph-query mode.');
       console.log('[grasp-it] Use grasp-search, grasp-chat, grasp-knowledge, or grasp-requirements to explore the graph.');
       console.log('[grasp-it] ROLE=non-developer');
     } else {
       console.log('\n[grasp-it] You are set up as a developer. Run /grasp to build or update the knowledge graph.');
       console.log('[grasp-it] ROLE=developer');
     }
   }

   main().catch(err => { console.error(err.message); process.exit(1); });
   ```

   Invoke it (pass `projectRoot` from the context), read the resulting `.env`, and `source` it:
   ```bash
   if [ $NEO4J_CONFIG_FOUND -eq 0 ]; then
     mkdir -p "$PROJECT_ROOT/.grasp-it/tmp"
     # Write the setup script (as shown above) to $PROJECT_ROOT/.grasp-it/tmp/first-use-setup.mjs
     # Then invoke it:
     SETUP_OUTPUT=$(node "$PROJECT_ROOT/.grasp-it/tmp/first-use-setup.mjs" "$PROJECT_ROOT" 2>&1)
     echo "$SETUP_OUTPUT"
     # After the script completes, source the written .env so bash phases have credentials
     if [ -f "$PROJECT_ROOT/.env" ]; then
       set -a
       source "$PROJECT_ROOT/.env" 2>/dev/null
       set +a
     fi
     # Check if the user identified as non-developer
     if echo "$SETUP_OUTPUT" | grep -q "ROLE=non-developer"; then
       GRASP_ROLE="non-developer"
     else
       GRASP_ROLE="developer"
     fi
   else
     # Config already exists — read role from global app config if present
     GRASP_ROLE="developer"
     if [ -f "$HOME/.grasp-it/config.json" ]; then
       SAVED_ROLE=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$HOME/.grasp-it/config.json','utf-8'));process.stdout.write(c.role||'')}catch{}" 2>/dev/null)
       if [ "$SAVED_ROLE" = "non-developer" ]; then
         GRASP_ROLE="non-developer"
       fi
     fi
   fi
   ```

   **Role check — stop early for non-developers:**
   ```bash
   if [ "$GRASP_ROLE" = "non-developer" ]; then
     echo ""
     echo "[grasp-it] You are configured as a non-developer (graph-query mode)."
     echo "[grasp-it] Skipping codebase scanning — no local codebase is needed."
     echo ""
     echo "[grasp-it] To explore the knowledge graph, use:"
     echo "  /grasp-search  — search nodes and relationships"
     echo "  /grasp-chat    — ask questions about the codebase"
     echo "  /grasp-knowledge — explore knowledge articles"
     echo "  /grasp-requirements — analyze requirements against the graph"
     echo ""
     echo "[grasp-it] Your Neo4j credentials are saved and ready for graph queries."
     exit 0
   fi
   ```

   **Note:** The `first-use-setup.mjs` script is ephemeral — it is written during Phase 0 and
   cleaned up with the rest of `$PROJECT_ROOT/.grasp-it/tmp/` in Phase 7 step 4.

 1.7. **Neo4j schema setup (first-use):**
   On first use, the graph requires schema constraints and indexes before `MERGE` operations
   and unique-constraint-dependent queries behave correctly. The schema definition lives at
   `<SKILL_DIR>/setup-neo4j-schema.cypher`. Apply it automatically if not yet present.

   **Detect already-applied schema:** Query for one well-known constraint (`project_id`) that
   is created by the schema setup. If it exists, the schema is already applied.
   ```bash
   SCHEMA_APPLIED=0
   if [ -n "$NEO4J_URI" ]; then
     # Try driver path first
     SCHEMA_CHECK=$(node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" \
       "SHOW CONSTRAINTS YIELD name WHERE name = 'project_id' RETURN name AS name" 2>/dev/null)
     if [ $? -eq 0 ]; then
       if echo "$SCHEMA_CHECK" | grep -q '"name":"project_id"'; then
         SCHEMA_APPLIED=1
       fi
     fi

     # If driver failed with exit 2, try cypher-shell path
     if [ $SCHEMA_APPLIED -eq 0 ]; then
       if [ "$NEO4J_CONNECTION_TYPE" = "cypher-shell" ] || \
          echo "$SCHEMA_CHECK" | grep -q "fallback\|cypher-shell\|not available" 2>/dev/null; then
         if command -v cypher-shell >/dev/null 2>&1; then
           URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
           URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
           [ -z "$URI_HOST" ] && URI_HOST="localhost"
           [ -z "$URI_PORT" ] && URI_PORT="7687"
           if cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" \
             --format plain "SHOW CONSTRAINTS YIELD name WHERE name = 'project_id' RETURN name AS name" 2>/dev/null | grep -q "project_id"; then
             SCHEMA_APPLIED=1
           fi
         fi
       fi
     fi
   fi
   ```

   **Apply schema if missing:**
   ```bash
   if [ $SCHEMA_APPLIED -eq 0 ] && [ -n "$NEO4J_URI" ]; then
     echo "[grasp-it] Applying Neo4j schema (first-use setup)..."
     # Read and apply the schema Cypher file
     if [ "$NEO4J_CONNECTION_TYPE" = "cypher-shell" ]; then
       # cypher-shell path — run the schema file directly
       if command -v cypher-shell >/dev/null 2>&1; then
         URI_HOST=$(echo "$NEO4J_URI" | sed 's/^neo4j\+:\/\///' | sed 's/:.*//')
         URI_PORT=$(echo "$NEO4J_URI" | sed -E 's/^neo4j\+:\/\/[^:]+://' | sed 's/\/.*//')
         [ -z "$URI_HOST" ] && URI_HOST="localhost"
         [ -z "$URI_PORT" ] && URI_PORT="7687"
         cypher-shell -a "bolt://${URI_HOST}:${URI_PORT}" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" \
           --format plain -f "$SKILL_DIR/setup-neo4j-schema.cypher" 2>/dev/null && \
           echo "[grasp-it] Neo4j schema applied successfully." || \
           echo "[grasp-it] Warning: Schema application returned non-zero (constraints may already exist — this is usually fine)"
       else
         echo "[grasp-it] Warning: cypher-shell not available for schema setup"
       fi
     elif [ "$NEO4J_CONNECTION_TYPE" = "mcp" ]; then
       echo "[grasp-it] MCP connection type — schema setup skipped (not yet supported)"
     else
       # Driver path — use run-query.mjs to apply schema line by line (driver doesn't support file input)
       # Run the schema setup queries individually via run-query.mjs
       while IFS= read -r line || [ -n "$line" ]; do
         # Skip comments and empty lines
         case "$line" in
           ""|\#*) continue ;;
           *) ;;
         esac
         # Apply each constraint/index statement
         node "$SKILL_DIR/run-query.mjs" "$PROJECT_ROOT" "$line" >/dev/null 2>&1
       done < "$SKILL_DIR/setup-neo4j-schema.cypher"
       echo "[grasp-it] Neo4j schema applied successfully."
     fi
   fi
   ```

   **Note:** The schema Cypher uses `IF NOT EXISTS` guards throughout, so re-running is safe.
   The check above only avoids the overhead of running it on every `/grasp` invocation.

2. Get the current git commit hash:
   ```bash
   git rev-parse HEAD
   ```
3. Create the intermediate and temp output directories:
   ```bash
   mkdir -p $PROJECT_ROOT/.grasp-it/intermediate
   mkdir -p $PROJECT_ROOT/.grasp-it/tmp
   ```
3.5. **Auto-update configuration:**
    - If `--auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": true}` to `$PROJECT_ROOT/.grasp-it/config.json`
    - If `--no-auto-update` is in `$ARGUMENTS`: write `{"autoUpdate": false}` to `$PROJECT_ROOT/.grasp-it/config.json`
    - These flags only set the config — analysis proceeds normally regardless.

 3.6. **Language configuration:**
    - Parse `$ARGUMENTS` for `--language <lang>` flag. If found, extract the language code.
    - **Language code normalization:** Map friendly names to ISO codes:
      - `chinese` → `zh`, `japanese` → `ja`, `korean` → `ko`, `english` → `en`, `spanish` → `es`, `french` → `fr`, `german` → `de`, `portuguese` → `pt`, `russian` → `ru`, `arabic` → `ar`, etc.
      - Locale variants: `zh-TW`, `zh-HK`, `zh-CN`, `pt-BR`, etc. are preserved as-is.
    - If `--language` is NOT specified:
      - Check `$PROJECT_ROOT/.grasp-it/config.json` for an existing `outputLanguage` field. If present, use that.
      - If no stored preference, default to `en` (English).
    - If `--language` IS specified:
      - Update `$PROJECT_ROOT/.grasp-it/config.json` with the new language: merge `{"outputLanguage": "<lang>"}` into existing config.
      - Store as `$OUTPUT_LANGUAGE` for use throughout all phases.
    - **Language directive template:** Store as `$LANGUAGE_DIRECTIVE`:
      ```markdown
      > **Language directive**: Generate all textual content (summaries, descriptions, tags, titles, languageNotes, languageLesson) in **{language}**. Maintain technical accuracy while using natural, native-level phrasing in the target language. Keep technical terms in English when no standard translation exists (e.g., "middleware", "hook", "barrel").
      ```

 
6.5. **Read `gitCommitHash` from Neo4j (Phase 0 staleness check):**
   Attempt to load the canonical `gitCommitHash` from the Neo4j `Project` singleton:
   ```bash
   node <SKILL_DIR>/run-query.mjs "$PROJECT_ROOT" "MATCH (p:Project {id: 'project:singleton'}) RETURN p.gitCommitHash AS gitCommitHash"
   ```
   
   - If the query returns a row with `gitCommitHash` field → use that as `lastCommitHash`
   - If the query returns no rows (no Project node yet) → treat as first run (full analysis)
   
   **Neo4j-only:** If Neo4j is unavailable or returns empty, the skill fails. There is no JSON fallback.
   
   **Variable to set:** Store the resolved `lastCommitHash` as `$LAST_COMMIT_HASH` for use in the decision logic below.
7. **Decision logic:**

   | Condition | Action |
   |---|---|
   | `--full` flag in `$ARGUMENTS` | Full analysis (all phases) |
   | No existing graph or meta | Full analysis (all phases) |
   | `--review` flag + existing graph + unchanged commit hash | Skip to Phase 6 (review-only — reuse existing assembled graph) |
   | Existing graph + unchanged commit hash | Ask the user: "The graph is up to date at this commit. Would you like to: **(a)** run a full rebuild (`--full`), **(b)** run the LLM graph reviewer (`--review`), or **(c)** do nothing?" Then follow their choice. If they pick (c), STOP. |
   | Existing graph + changed files | Incremental update (re-analyze changed files only) |

   **Review-only path:** Copy the existing `knowledge-graph.json` to `$PROJECT_ROOT/.grasp-it/intermediate/assembled-graph.json`, then jump directly to Phase 6 step 3.

   For incremental updates, get the changed file list:
   ```bash
   git diff <lastCommitHash>..HEAD --name-only
   ```
   If this returns no files, report "Graph is up to date" and STOP.

8. **Collect project context for subagent injection:**
   - Read `README.md` (or `README.rst`, `readme.md`) from `$PROJECT_ROOT` if it exists. Store as `$README_CONTENT` (first 3000 characters).
   - Read the primary package manifest (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`) if it exists. Store as `$MANIFEST_CONTENT`.
   - Capture the top-level directory tree:
     ```bash
     find $PROJECT_ROOT -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100
     ```
     Store as `$DIR_TREE`.
   - Detect the project entry point by checking for common patterns (in order): `src/index.ts`, `src/main.ts`, `src/App.tsx`, `index.js`, `main.py`, `manage.py`, `app.py`, `wsgi.py`, `asgi.py`, `run.py`, `__main__.py`, `main.go`, `cmd/*/main.go`, `src/main.rs`, `src/lib.rs`, `src/main/java/**/Application.java`, `Program.cs`, `config.ru`, `index.php`. Store first match as `$ENTRY_POINT`.

---

## Phase 0.5 — Ignore Configuration

Set up and verify the `.graspignore` file before scanning.

1. Check if `$PROJECT_ROOT/.grasp-it/.graspignore` exists.
2. **If it does NOT exist**, generate a starter file:
   - Run the following Node.js one-liner in `$PROJECT_ROOT` (reads `.gitignore` and deduplicates against built-in defaults):
     ```bash
     node -e "
     const fs = require('fs');
     const path = require('path');
     const root = process.cwd();
     const defaults = ['node_modules/','node_modules','.git/','vendor/','venv/','.venv/','__pycache__/','dist/','dist','build/','build','out/','coverage/','coverage','.next/','.cache/','.turbo/','target/','obj/','*.lock','package-lock.json','yarn.lock','pnpm-lock.yaml','*.png','*.jpg','*.jpeg','*.gif','*.svg','*.ico','*.woff','*.woff2','*.ttf','*.eot','*.mp3','*.mp4','*.pdf','*.zip','*.tar','*.gz','*.min.js','*.min.css','*.map','*.generated.*','.idea/','.vscode/','LICENSE','.gitignore','.editorconfig','.prettierrc','.eslintrc*','*.log'];
     const norm = p => p.replace(/\/+$/, '');
     const defaultSet = new Set(defaults.map(norm));
     const header = '# .graspignore — patterns for files/dirs to exclude from analysis\n# Syntax: same as .gitignore (globs, # comments, ! negation, trailing / for dirs)\n# Lines below are suggestions — uncomment to activate.\n# Use ! prefix to force-include something excluded by defaults.\n#\n# Built-in defaults (always excluded unless negated):\n#   node_modules/, .git/, dist/, build/, obj/, *.lock, *.min.js, etc.\n#\n';
     let body = '';
     const gitignorePath = path.join(root, '.gitignore');
     if (fs.existsSync(gitignorePath)) {
       const gi = fs.readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).filter(p => !defaultSet.has(norm(p)));
       if (gi.length) { body += '# --- From .gitignore (uncomment to exclude) ---\n\n' + gi.map(p => '# ' + p).join('\n') + '\n\n'; }
     }
     const dirs = ['__tests__','test','tests','fixtures','testdata','docs','examples','scripts','migrations','.storybook'];
     const found = dirs.filter(d => fs.existsSync(path.join(root, d)));
     if (found.length) { body += '# --- Detected directories (uncomment to exclude) ---\n\n' + found.map(d => '# ' + d + '/').join('\n') + '\n\n'; }
     body += '# --- Test file patterns (uncomment to exclude) ---\n\n# *.test.*\n# *.spec.*\n# *.snap\n';
     const outDir = path.join(root, '.grasp-it');
     if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
     fs.writeFileSync(path.join(outDir, '.graspignore'), header + body);
     "
     ```
   - Report to the user:
     > Generated `.grasp-it/.graspignore` with suggested exclusions based on your project structure. You can edit it later if needed.
3. Proceed to Phase 1.

---

## Phase 1 — SCAN (Full analysis only)

Report to the user: `[Phase 1/7] Scanning project files...`

Dispatch a subagent using the `project-scanner` agent definition (at `agents/project-scanner.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Package manifest:
> ```
> $MANIFEST_CONTENT
> ```
>
> Use this context to produce more accurate project name, description, and framework detection. The README and manifest are authoritative — prefer their information over heuristics.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Scan this project directory to discover all project files (including non-code files like configs, docs, infrastructure), detect languages and frameworks.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.grasp-it/intermediate/scan-result.json`

**`--files` scope constraint:** If `--files <comma-list>` was passed to `/grasp`, include ONLY the files from that list in the output `files[]` array. The bundled scanner still walks the full project (to build the complete `importMap` for cross-file edge detection), but the `files` array in `scan-result.json` must contain only the paths from `--files`. Do NOT invent files not in the `--files` list.

After the subagent completes, read `$PROJECT_ROOT/.grasp-it/intermediate/scan-result.json` to get:
- Project name, description
- Languages, frameworks
- File list with line counts and `fileCategory` per file (`code`, `config`, `docs`, `infra`, `data`, `script`, `markup`)
- Complexity estimate
- Import map (`importMap`): pre-resolved project-internal imports per file (non-code files have empty arrays)

Store `importMap` in memory as `$IMPORT_MAP` for use in Phase 2 batch construction.
Store the file list as `$FILE_LIST` with `fileCategory` metadata for use in Phase 2 batch construction.

**Gate check:** If >100 files, inform the user and suggest scoping with a subdirectory argument. Proceed only if user confirms or add guidance that this may take a while.

If the scan result includes `filteredByIgnore > 0`, report:
> Excluded {filteredByIgnore} files via `.graspignore`.

---

## Phase 1.5 — BATCH

Report: `[Phase 1.5/7] Computing semantic batches...`

Run the bundled batching script:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT
```

Reads `.grasp-it/intermediate/scan-result.json`, writes `.grasp-it/intermediate/batches.json`.

Capture stderr. Append any line starting with `Warning:` to `$PHASE_WARNINGS` for the final report.

If the script exits non-zero, the failure is hard — relay the full stderr to the user as a Phase 1.5 failure. Do not attempt to recover; the script's internal fallback (count-based) already handles recoverable issues. A non-zero exit means a fundamental problem (missing input file, malformed JSON, etc.).

---

## Phase 2 — ANALYZE

### Full analysis path

Load `.grasp-it/intermediate/batches.json` (produced by Phase 1.5). Iterate the `batches[]` array.

Report: `[Phase 2/7] Analyzing files — <totalFiles> files in <totalBatches> batches (up to 5 concurrent)...`

For each batch, dispatch a subagent using the `file-analyzer` agent definition (at `agents/file-analyzer.md`). Run up to **5 subagents concurrently**. Append the following additional context:

> **Additional context from main session:**
>
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages from Phase 1>`
>
> $LANGUAGE_DIRECTIVE

Dispatch prompt template (fill in batch-specific values from `batches.json[i]`):

> Analyze these files and produce GraphNode and GraphEdge objects.
> Project root: `$PROJECT_ROOT`
> Project: `<projectName>`
> Languages: `<languages>`
> Batch: `<batchIndex>/<totalBatches>`
> Skill directory (for bundled scripts): `<SKILL_DIR>`
> Output: write to `$PROJECT_ROOT/.grasp-it/intermediate/batch-<batchIndex>.json` (single-file mode) OR `batch-<batchIndex>-part-<k>.json` (split mode, per Step B of your output protocol).
>
> Pre-resolved import data for this batch (use directly — do NOT re-resolve imports from source):
> ```json
> <batchImportData JSON from batches.json[i].batchImportData>
> ```
>
> Cross-batch neighbors with their exported symbols (confidence boost for cross-batch edges):
> ```json
> <neighborMap JSON from batches.json[i].neighborMap>
> ```
>
> Files to analyze in this batch (every entry MUST be passed through to `batchFiles` with all four fields — `path`, `language`, `sizeLines`, `fileCategory`):
> 1. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> 2. `<path>` (<sizeLines> lines, language: `<language>`, fileCategory: `<fileCategory>`)
> ...

**Output naming is per-batchIndex — no fusion.** If you fuse multiple small batches into a single file-analyzer dispatch for token efficiency, the dispatched agent must STILL write one output file per original `batchIndex` using `batch-<batchIndex>.json` or `batch-<batchIndex>-part-<k>.json`. The merge script's regex (`batch-(\d+)(?:-part-(\d+))?\.json`) silently drops any other naming (e.g., `batch-fused-8-13.json`, `batch-8-13.json`), losing every node and edge in that file. After each dispatch returns, verify each `batchIndex` in the dispatched input has a corresponding `batch-<batchIndex>.json` (or `batch-<batchIndex>-part-*.json`) on disk before proceeding to the next dispatch.

After ALL batches complete, report to the user: `Phase 2 complete. All <totalBatches> batches analyzed.`

The batch analysis results are assembled by the `assemble-reviewer` agent in Phase 3. Batch files (`batch-*.json`, `batch-<i>-part-<k>.json`) are written to `$PROJECT_ROOT/.grasp-it/intermediate/` by file-analyzer subagents.

### Incremental update path

Write the changed-files list (one path per line) to a temp file:
```bash
git diff <lastCommitHash>..HEAD --name-only > $PROJECT_ROOT/.grasp-it/tmp/changed-files.txt
```

**Filter cosmetic vs. structural changes.** Load the fingerprint baseline and classify each changed file:
```bash
node <SKILL_DIR>/filter-structural-changes.mjs $PROJECT_ROOT
```

This writes two files:
- `.grasp-it/tmp/structural-changed-files.txt` — files with STRUCTURAL or NEW changes (LLM re-analysis required)
- `.grasp-it/tmp/cosmetic-only-files.txt` — files with COSMETIC or NONE changes (LLM re-analysis skipped)

If `fingerprints.json` does not exist (first run after upgrade), the script falls back to treating all changed files as STRUCTURAL.

Run compute-batches on the **structural** list only:
```bash
node <SKILL_DIR>/compute-batches.mjs $PROJECT_ROOT \
  --changed-files=$PROJECT_ROOT/.grasp-it/tmp/structural-changed-files.txt
```

This produces a `batches.json` that contains only batches with structural changes, but neighborMap entries still reference unchanged files (with their full-graph batchIndex) so cross-batch edges remain emittable.

Then dispatch file-analyzer subagents per the same template as the full path.

After batches complete:
1. Remove old nodes whose `filePath` matches any **structural** changed file from the existing graph
2. Remove old edges whose `source` or `target` references a removed node
3. Write the pruned existing nodes/edges as `batch-existing.json` in the intermediate directory
4. Run the assemble-reviewer agent — it combines `batch-existing.json` with the fresh `batch-*.json` files and writes `assembled-graph.json`.

---

## Phase 3 — ASSEMBLE REVIEW

Report to the user: `[Phase 3/7] Reviewing assembled graph...`

Dispatch a subagent using the `assemble-reviewer` agent definition (at `agents/assemble-reviewer.md`).

Pass these parameters in the dispatch prompt:

> Review the assembled graph at `$PROJECT_ROOT/.grasp-it/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Batch files are at: `$PROJECT_ROOT/.grasp-it/intermediate/batch-*.json`
> Write review output to: `$PROJECT_ROOT/.grasp-it/intermediate/assemble-review.json`
>
> **Assembly report:** (review the assembled graph directly — the merge is handled by the assemble-reviewer agent)
>
> **Import map for cross-batch edge verification:**
> ```json
> $IMPORT_MAP
> ```

After the subagent completes, read `$PROJECT_ROOT/.grasp-it/intermediate/assemble-review.json` and add any notes to `$PHASE_WARNINGS`.

---

## Phase 4 — ARCHITECTURE

Report to the user: `[Phase 4/7] Identifying architectural layers...`

**Build the combined prompt template:**
 1. Use the `architecture-analyzer` agent definition (at `agents/architecture-analyzer.md`).
 2. **Language context injection:** For each language detected in Phase 1 (e.g., `python`, `markdown`, `dockerfile`, `yaml`, `sql`, `terraform`, `graphql`, `protobuf`, `shell`, `html`, `css`), read the file at `./languages/<language-id>.md` (e.g., `./languages/python.md`, `./languages/dockerfile.md`) and append its content after the base template under a `## Language Context` header. If the file does not exist for a detected language, skip it silently and continue. These files are in the `languages/` subdirectory next to this SKILL.md file. **Include non-code language snippets** — they provide edge patterns and summary styles for non-code files.
 3. **Framework addendum injection:** For each framework detected in Phase 1 (e.g., `Django`), read the file at `./frameworks/<framework-id-lowercase>.md` (e.g., `./frameworks/django.md`) and append its full content after the language context. If the file does not exist for a detected framework, skip it silently and continue. These files are in the `frameworks/` subdirectory next to this SKILL.md file.
 4. **Output locale injection:** If `$OUTPUT_LANGUAGE` is NOT `en` (English), read the locale guidance file at `./locales/<language-code>.md` (e.g., `./locales/zh.md`, `./locales/ja.md`, `./locales/ko.md`) and append its content after the framework addendums under a `## Output Language Guidelines` header. This provides language-specific guidance for tag naming conventions, summary style, and layer name translations. If the locale file does not exist for the specified language, skip silently — the `$LANGUAGE_DIRECTIVE` still applies. These files are in the `locales/` subdirectory next to this SKILL.md file.

Append the language/framework context and the following additional context to the agent's prompt:

> **Additional context from main session:**
>
> Frameworks detected: `<frameworks from Phase 1>`
>
> Directory tree (top 2 levels):
> ```
> $DIR_TREE
> ```
>
> Use the directory tree, language context, and framework addendums (appended above) to inform layer assignments. Directory structure is strong evidence for layer boundaries. Non-code files (config, docs, infrastructure, data) should be assigned to appropriate layers — see the prompt template for guidance.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Analyze this codebase's structure to identify architectural layers.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.grasp-it/intermediate/layers.json`
> Project: `<projectName>` — `<projectDescription>`
>
> File nodes (all node types — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, type, name, filePath, summary, tags} for ALL file-level nodes — omit complexity, languageNotes]
> ```
>
> Import edges:
> ```json
> [list of edges with type "imports"]
> ```
>
> All edges (for cross-category analysis — includes configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types]
> ```

After the subagent completes, read `$PROJECT_ROOT/.grasp-it/intermediate/layers.json` and normalize it into a final `layers` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "layers": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any layer object has a `nodes` field instead of `nodeIds`, rename `nodes` → `nodeIds`. If `nodes` entries are objects with an `id` field rather than plain strings, extract just the `id` values into `nodeIds`.
3. **Synthesize missing IDs:** If any layer is missing an `id`, generate one as `layer:<kebab-case-name>`.
4. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
5. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.

Each element of the final `layers` array MUST have this shape:

```json
[
  {
    "id": "layer:<kebab-case-name>",
    "name": "<layer name>",
    "description": "<what belongs in this layer>",
    "nodeIds": ["file:src/App.tsx", "config:tsconfig.json", "document:README.md"]
  }
]
```

All four fields (`id`, `name`, `description`, `nodeIds`) are required.

**For incremental updates:** Always re-run architecture analysis on the full merged node set, since layer assignments may shift when files change.

**Context for incremental updates:** When re-running architecture analysis, also inject the previous layer definitions:

> Previous layer definitions (for naming consistency):
> ```json
> [previous layers from existing graph]
> ```
>
> Maintain the same layer names and IDs where possible. Only add/remove layers if the file structure has materially changed.

---

## Phase 5 — TOUR

Report to the user: `[Phase 5/7] Building guided tour...`

Dispatch a subagent using the `tour-builder` agent definition (at `agents/tour-builder.md`). Append the following additional context:

> **Additional context from main session:**
>
> Project README (first 3000 chars):
> ```
> $README_CONTENT
> ```
>
> Project entry point: `$ENTRY_POINT`
>
> Use the README to align the tour narrative with the project's own documentation. Start the tour from the entry point if one was detected. The tour should tell the same story the README tells, but through the lens of actual code structure.
>
> $LANGUAGE_DIRECTIVE

Pass these parameters in the dispatch prompt:

> Create a guided learning tour for this codebase.
> Project root: `$PROJECT_ROOT`
> Write output to: `$PROJECT_ROOT/.grasp-it/intermediate/tour.json`
> Project: `<projectName>` — `<projectDescription>`
> Languages: `<languages>`
>
> Nodes (all file-level nodes — includes code files, config, document, service, pipeline, table, schema, resource, endpoint):
> ```json
> [list of {id, name, filePath, summary, type} for ALL file-level nodes — do NOT include function or class nodes]
> ```
>
> Layers:
> ```json
> [list of {id, name, description} for each layer — omit nodeIds]
> ```
>
> Edges (all types — includes imports, calls, configures, documents, deploys, triggers, etc.):
> ```json
> [list of ALL edges — include all edge types for complete graph topology analysis]
> ```

After the subagent completes, read `$PROJECT_ROOT/.grasp-it/intermediate/tour.json` and normalize it into a final `tour` array. Apply these steps **in order**:

1. **Unwrap envelope:** If the file contains `{ "steps": [...] }` instead of a plain array, extract the inner array. (The prompt requests a plain array, but LLMs may still produce an envelope.)
2. **Rename legacy fields:** If any step has `nodesToInspect` instead of `nodeIds`, rename it → `nodeIds`. If any step has `whyItMatters` instead of `description`, rename it → `description`.
3. **Convert file paths:** If `nodeIds` entries are raw file paths without a known prefix (`file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`), convert them to `file:<relative-path>`.
4. **Drop dangling refs:** Remove any `nodeIds` entries that do not exist in the merged node set.
5. **Sort** by `order` before saving.

Each element of the final `tour` array MUST have this shape:

```json
[
  {
    "order": 1,
    "title": "Project Overview",
    "description": "Start with the README to grasp the project's purpose and architecture.",
    "nodeIds": ["document:README.md"]
  },
  {
    "order": 2,
    "title": "Application Entry Point",
    "description": "This step explains how the frontend boots and mounts.",
    "nodeIds": ["file:src/main.tsx", "file:src/App.tsx"]
  }
]
```

Required fields: `order`, `title`, `description`, `nodeIds`. Preserve optional `languageLesson` when present.

---

## Phase 6 — REVIEW

Report to the user: `[Phase 6/7] Validating knowledge graph...`

Assemble the full KnowledgeGraph JSON object:

```json
{
  "version": "1.0.0",
  "project": {
    "name": "<projectName>",
    "languages": ["<languages>"],
    "frameworks": ["<frameworks>"],
    "description": "<projectDescription>",
    "analyzedAt": "<ISO 8601 timestamp>",
    "gitCommitHash": "<commit hash from Phase 0>"
  },
  "nodes": [<all nodes from assembled-graph.json after Phase 3 review>],
  "edges": [<all edges from assembled-graph.json after Phase 3 review>],
  "layers": [<layers from Phase 4>],
  "tour": [<steps from Phase 5>]
}
```

1. Before writing the assembled graph, validate that:
   - `layers` is an array of objects with these required fields: `id`, `name`, `description`, `nodeIds`
   - `tour` is an array of objects with these required fields: `order`, `title`, `description`, `nodeIds`
   - `tour[*].languageLesson` is allowed as an optional string field
   - Every `layers[*].nodeIds` entry exists in the merged node set
   - Every `tour[*].nodeIds` entry exists in the merged node set

   If validation fails, automatically normalize and rewrite the graph into this shape before saving. If the graph still fails final validation after the normalization pass, save it with warnings but mark dashboard auto-launch as skipped.

2. Write the assembled graph to `$PROJECT_ROOT/.grasp-it/intermediate/assembled-graph.json`.

3. **Check `$ARGUMENTS` for `--review` flag.** Then run the appropriate validation path:

---

#### Default path (no `--review`): inline deterministic validation

Write the following Node.js script to `$PROJECT_ROOT/.grasp-it/tmp/ua-inline-validate.cjs`:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const graphPath = process.argv[2];
const outputPath = process.argv[3];
try {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const issues = [], warnings = [];
  if (!Array.isArray(graph.nodes)) { issues.push('graph.nodes is missing or not an array'); graph.nodes = []; }
  if (!Array.isArray(graph.edges)) { issues.push('graph.edges is missing or not an array'); graph.edges = []; }
  const nodeIds = new Set();
  const seen = new Map();
  graph.nodes.forEach((n, i) => {
    if (!n.id) { issues.push(`Node[${i}] missing id`); return; }
    if (!n.type) issues.push(`Node[${i}] '${n.id}' missing type`);
    if (!n.name) issues.push(`Node[${i}] '${n.id}' missing name`);
    if (!n.summary) issues.push(`Node[${i}] '${n.id}' missing summary`);
    if (!n.tags || !n.tags.length) issues.push(`Node[${i}] '${n.id}' missing tags`);
    if (seen.has(n.id)) issues.push(`Duplicate node ID '${n.id}' at indices ${seen.get(n.id)} and ${i}`);
    else seen.set(n.id, i);
    nodeIds.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!nodeIds.has(e.source)) issues.push(`Edge[${i}] source '${e.source}' not found`);
    if (!nodeIds.has(e.target)) issues.push(`Edge[${i}] target '${e.target}' not found`);
  });
  const fileLevelTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
  const fileNodes = graph.nodes.filter(n => fileLevelTypes.has(n.type)).map(n => n.id);
  const assigned = new Map();
  if (!Array.isArray(graph.layers)) { if (graph.layers) warnings.push('graph.layers is not an array'); graph.layers = []; }
  if (!Array.isArray(graph.tour)) { if (graph.tour) warnings.push('graph.tour is not an array'); graph.tour = []; }
  graph.layers.forEach(layer => {
    (layer.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Layer '${layer.id}' refs missing node '${id}'`);
      if (assigned.has(id)) issues.push(`Node '${id}' appears in multiple layers`);
      assigned.set(id, layer.id);
    });
  });
  fileNodes.forEach(id => {
    if (!assigned.has(id)) issues.push(`File node '${id}' not in any layer`);
  });
  graph.tour.forEach((step, i) => {
    (step.nodeIds || []).forEach(id => {
      if (!nodeIds.has(id)) issues.push(`Tour step[${i}] refs missing node '${id}'`);
    });
  });
  const withEdges = new Set([
    ...graph.edges.map(e => e.source),
    ...graph.edges.map(e => e.target)
  ]);
  graph.nodes.forEach(n => {
    if (!withEdges.has(n.id)) warnings.push(`Node '${n.id}' has no edges (orphan)`);
  });
  const stats = {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: graph.nodes.reduce((a, n) => { a[n.type] = (a[n.type]||0)+1; return a; }, {}),
    edgeTypes: graph.edges.reduce((a, e) => { a[e.type] = (a[e.type]||0)+1; return a; }, {})
  };
  fs.writeFileSync(outputPath, JSON.stringify({ issues, warnings, stats }, null, 2));
  process.exit(0);
} catch (err) { process.stderr.write(err.message + '\n'); process.exit(1); }
```

Execute it:
```bash
node $PROJECT_ROOT/.grasp-it/tmp/ua-inline-validate.cjs \
  "$PROJECT_ROOT/.grasp-it/intermediate/assembled-graph.json" \
  "$PROJECT_ROOT/.grasp-it/intermediate/review.json"
```

If the script exits non-zero, read stderr, fix the script, and retry once.

---

#### `--review` path: full LLM reviewer

If `--review` IS in `$ARGUMENTS`, dispatch the LLM graph-reviewer subagent as follows:

Dispatch a subagent using the `graph-reviewer` agent definition (at `agents/graph-reviewer.md`). Append the following additional context:

> **Additional context from main session:**
>
> Phase 1 scan results (file inventory):
> ```json
> [list of {path, sizeLines} from scan-result.json]
> ```
>
> Phase warnings/errors accumulated during analysis:
> - [list any batch failures, skipped files, or warnings from Phases 2-5]
>
> Cross-validate: every file in the scan inventory should have a corresponding node in the graph (node types may vary: `file:`, `config:`, `document:`, `service:`, `pipeline:`, `table:`, `schema:`, `resource:`, `endpoint:`). Flag any missing files. Also flag any graph nodes whose `filePath` doesn't appear in the scan inventory.

Pass these parameters in the dispatch prompt:

> Validate the knowledge graph at `$PROJECT_ROOT/.grasp-it/intermediate/assembled-graph.json`.
> Project root: `$PROJECT_ROOT`
> Read the file and validate it for completeness and correctness.
> Write output to: `$PROJECT_ROOT/.grasp-it/intermediate/review.json`

---

4. Read `$PROJECT_ROOT/.grasp-it/intermediate/review.json`.

5. **If `issues` array is non-empty:**
   - Review the `issues` list
   - Apply automated fixes where possible:
     - Remove edges with dangling references
     - Fill missing required fields with sensible defaults (e.g., empty `tags` -> `["untagged"]`, empty `summary` -> `"No summary available"`)
     - Remove nodes with invalid types
   - Re-run the final graph validation after automated fixes
   - If critical issues remain after one fix attempt, save the graph anyway but include the warnings in the final report and mark dashboard auto-launch as skipped

6. **If `issues` array is empty:** Proceed to Phase 7.

---

## Phase 7 — SAVE

Report to the user: `[Phase 7/7] Saving knowledge graph...`

**Neo4j-only:** The knowledge graph is written directly to Neo4j. There is no JSON file fallback. If Neo4j is unavailable, the skill fails.

1. **Generate structural fingerprints baseline.** This creates the basis for future automatic incremental updates and **must succeed before the graph is saved** — otherwise auto-update sees a fresh commit hash with no fingerprints to compare against, classifies every file as STRUCTURAL, and escalates to `FULL_UPDATE` on every subsequent commit (issue #152).

   Write the input file:
   ```bash
   cat > $PROJECT_ROOT/.grasp-it/intermediate/fingerprint-input.json <<EOF
   {
     "projectRoot": "$PROJECT_ROOT",
     "sourceFilePaths": [<all source file paths from Phase 1, as JSON array>],
     "gitCommitHash": "<current commit hash>"
   }
   EOF
   ```

   Then invoke the bundled script (located next to this SKILL.md):
   ```bash
   node <SKILL_DIR>/build-fingerprints.mjs \
     $PROJECT_ROOT/.grasp-it/intermediate/fingerprint-input.json
   ```

   The script uses `TreeSitterPlugin + PluginRegistry` exactly like `extract-structure.mjs`, so the baseline matches the comparison logic used during auto-updates.

   **If the script exits non-zero or stdout does not include `Fingerprints baseline:`, abort Phase 7 and report the error. Do NOT proceed to step 2.**

2. **Persist knowledge graph to Neo4j:**
   After fingerprints are saved, push the assembled graph to Neo4j using the bundled script:
   ```bash
   node <SKILL_DIR>/push-codebase-graph.mjs "$PROJECT_ROOT"
   EXIT_CODE=$?
   if [ $EXIT_CODE -ne 0 ]; then
     echo ""
     echo "Error: Failed to persist knowledge graph to Neo4j. The skill cannot continue without a successful Neo4j write."
     echo ""
     exit 1
   fi
   ```
   
   The script reads `assembled-graph.json` from `.grasp-it/intermediate/`, writes all nodes with the `Codebase:` grouping label (e.g., `Codebase:File`, `Codebase:Function`), creates `RELATES` edges, and updates the `Project` singleton with `gitCommitHash`, `lastAnalyzedAt`, `version`, and `analyzedFiles`.
   
   - Exit code 0 → Neo4j write succeeded
   - Exit code 1 → Neo4j write failed — the skill exits with an error
   
   **Note:** The `analyzedFiles` count is computed by the script as the number of nodes with type `"file"` in the assembled graph.

3. Clean up intermediate files:
   ```bash
   rm -rf $PROJECT_ROOT/.grasp-it/intermediate
   rm -rf $PROJECT_ROOT/.grasp-it/tmp
   ```

4. Report a summary to the user containing:
   - Project name and description
   - Files analyzed / total files (with breakdown by fileCategory: code, config, docs, infra, data, script, markup)
   - Nodes created (broken down by type: file, function, class, config, document, service, table, endpoint, pipeline, schema, resource)
   - Edges created (broken down by type)
   - Layers identified (with names)
   - Tour steps generated (count)
   - Any warnings from the reviewer
   - Confirmation that the graph was saved to Neo4j

5. Only automatically launch the dashboard by invoking the `/grasp-dashboard` skill if final graph validation passed after normalization/review fixes.
   If final validation did not pass, report that the graph was saved with warnings and dashboard launch was skipped.

---

## Error Handling

- If any subagent dispatch fails, retry **once** with the same prompt plus additional context about the failure.
- Track all warnings and errors from each phase in a `$PHASE_WARNINGS` list. When using `--review`, pass this list to the graph-reviewer in Phase 6. On the default path, include accumulated warnings in the Phase 7 final report.
- If it fails a second time, skip that phase and continue with partial results.
- ALWAYS save partial results — a partial graph is better than no graph.
- Report any skipped phases or errors in the final summary so the user knows what happened.
- NEVER silently drop errors. Every failure must be visible in the final report.

---

## Reference: KnowledgeGraph Schema

### Node Types (13 total)
| Type | Description | ID Convention |
|---|---|---|
| `file` | Source code file | `file:<relative-path>` |
| `function` | Function or method | `function:<relative-path>:<name>` |
| `class` | Class, interface, or type | `class:<relative-path>:<name>` |
| `module` | Logical module or package | `module:<name>` |
| `concept` | Abstract concept or pattern | `concept:<name>` |
| `config` | Configuration file (YAML, JSON, TOML, env) | `config:<relative-path>` |
| `document` | Documentation file (Markdown, RST, TXT) | `document:<relative-path>` |
| `service` | Deployable service definition (Dockerfile, K8s) | `service:<relative-path>` |
| `table` | Database table or migration | `table:<relative-path>:<table-name>` |
| `endpoint` | API endpoint or route definition | `endpoint:<relative-path>:<endpoint-name>` |
| `pipeline` | CI/CD pipeline configuration | `pipeline:<relative-path>` |
| `schema` | Schema definition (GraphQL, Protobuf, Prisma) | `schema:<relative-path>` |
| `resource` | Infrastructure resource (Terraform, CloudFormation) | `resource:<relative-path>` |

### Edge Types (26 total)
| Category | Types |
|---|---|
| Structural | `imports`, `exports`, `contains`, `inherits`, `implements` |
| Behavioral | `calls`, `subscribes`, `publishes`, `middleware` |
| Data flow | `reads_from`, `writes_to`, `transforms`, `validates` |
| Dependencies | `depends_on`, `tested_by`, `configures` |
| Semantic | `related`, `similar_to` |
| Infrastructure | `deploys`, `serves`, `provisions`, `triggers` |
| Schema/Data | `migrates`, `documents`, `routes`, `defines_schema` |

### Edge Weight Conventions
| Edge Type | Weight |
|---|---|
| `contains` | 1.0 |
| `inherits`, `implements` | 0.9 |
| `calls`, `exports`, `defines_schema` | 0.8 |
| `imports`, `deploys`, `migrates` | 0.7 |
| `depends_on`, `configures`, `triggers` | 0.6 |
| `tested_by`, `documents`, `provisions`, `serves`, `routes` | 0.5 |
| All others | 0.5 (default) |
