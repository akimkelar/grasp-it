# Neo4j Configuration for Non-Developer Users

## Overview

The grasp-it plugin is designed primarily for non-developer users running it via **Codex (OpenAI) and ChatGPT**, including Windows users with no development background. It also supports Claude Code. The plugin supports multiple Neo4j connection methods to accommodate different user environments, from local installations to cloud services. This document describes the configuration system, connection types, and first-use setup flow.

## Connection Types

The plugin supports three Neo4j connection types, configured via `NEO4J_CONNECTION_TYPE`:

### 1. cypher-shell (default)

Uses the Neo4j CLI tool (`cypher-shell`) to execute queries. Works with:
- Neo4j Desktop
- Neo4j Aura (cloud)
- Self-managed Neo4j

**Requirements:**
- Neo4j CLI installed and available in PATH
- Java 21+ for cypher-shell

**Command format:**
```bash
cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" --format plain "QUERY"
```

### 2. MCP (Model Context Protocol)

Uses the official `neo4j-mcp` server to connect via the MCP protocol.

**Requirements:**
- `neo4j-mcp` binary installed
- APOC plugin on the Neo4j instance

**Reference:** See `skills/neo4j-cli-tools-skill/references/neo4j-mcp-reference.md`

### 3. Driver (neo4j-driver)

Direct connection using the `neo4j-driver` Node.js package. If bundled as a plugin dependency, this requires **no manual installation** — making it the most accessible option for non-developer Codex/ChatGPT users on any platform including Windows (no Java, no extra CLI tools needed).

**Requirements:**
- `neo4j-driver` package (bundled with the plugin as a dependency — no user action required)

## Configuration Files

### Project-level Configuration

Credentials are stored in `.env` at the project root:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_DATABASE=neo4j
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_CONNECTION_TYPE=cypher-shell
```

The `.env` file is automatically added to `.gitignore` when configuration is created.

### Global Configuration

For shared credentials across projects, the plugin supports a global config at `~/.grasp-it/neo4j.env`.

### Environment Variable Fallback

For CI/deployment scenarios, the plugin checks standard environment variables:
- `NEO4J_URI`
- `NEO4J_DATABASE`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `NEO4J_CONNECTION_TYPE`

## First-Use Setup Flow

When no configuration is found, the plugin guides users through setup:

1. **Connection type selection** — Choose between cypher-shell (default), MCP, or driver
2. **URI input** — Provide Neo4j connection URI
   - Local: `bolt://localhost:7687`
   - Aura: `neo4j+s://xxxxx.databases.neo4j.io`
3. **Database name** — Default is `neo4j`
4. **Credentials** — Username and password
5. **Config storage** — Choose project-level (`.env`) or global (`~/.grasp-it/`)

## Configuration Loading Order

The plugin checks configuration sources in this priority order:

1. Environment variables (for CI/deployment)
2. Project `.env` file
3. Global `~/.grasp-it/neo4j.env` file

## Neo4j Schema Setup

After configuring the connection, apply the schema constraints:

```bash
cypher-shell -a "$NEO4J_URI" -u "$NEO4J_USERNAME" -p "$NEO4J_PASSWORD" -d "$NEO4J_DATABASE" < grasp-it-plugin/skills/grasp/setup-neo4j-schema.cypher
```

Or via MCP, use the schema setup script in the configured MCP session.

## Security Notes

- Credentials are never logged or exposed in prompts
- `.env` files are added to `.gitignore` automatically
- Use strong passwords for production databases
- Consider using read-only mode for analysis tasks

## Alternative Connection Methods (Research Summary)

### Option A — Neo4j Aura (cloud)

**How it works:** User provides a `neo4j+s://...` URI instead of a local path.

**Pros:**
- No local installation required
- Works immediately with cloud databases
- Minimal configuration changes needed

**Cons:**
- Requires Aura subscription
- Network dependency

**Recommendation:** Fully supported — `NEO4J_URI=neo4j+s://...` works with all connection types.

### Option B — MCP (Model Context Protocol)

**How it works:** Connect via `neo4j-mcp` server which implements the MCP protocol.

**Pros:**
- Standardized AI agent integration
- Works with all Neo4j deployment types
- Built-in schema inspection and query tools

**Cons:**
- Requires `neo4j-mcp` binary installation
- Additional setup step

**Recommendation:** Supported — the plugin includes comprehensive `neo4j-mcp` documentation in `skills/neo4j-cli-tools-skill/`.

### Option C — Cypher Shell

**How it works:** Spawn `cypher-shell` as a subprocess for query execution.

**Pros:**
- Bundled with Neo4j installations
- No additional package dependencies
- Works cross-platform

**Cons:**
- Requires Neo4j CLI installation
- Java version compatibility issues (use Java 21)

**Recommendation:** Suitable for users who already have Neo4j Desktop installed, but requires Java 21 and CLI knowledge — not ideal for non-developers.

## Windows Compatibility

The configuration system uses `path.join()` for all path construction, ensuring Windows compatibility:

- Paths use backslash/forward slash as appropriate for the OS
- `.env` file creation works in Windows-style project directories
- Global config path `~/.grasp-it/` resolves correctly on Windows