# Task 13: Neo4j Configuration for Non-Developer Users

## Description

The grasp-it-plugin is used by non-developers via Codex and ChatGPT, including Windows
users who are not developers. Currently, the plugin requires manual Neo4j configuration
that these users cannot perform. This task adds automatic first-use setup so the plugin
can prompt for credentials and create a `.env` file, and also adds alternative connection
methods (Cypher interface, MCP) so non-developers can use the plugin without configuring
a local Neo4j installation.

## Why this matters

The plugin is marketed to non-developer users (Codex/ChatGPT), yet the current setup
requires:
- Editing environment variables or `.env` files
- Running `npm install` / `pnpm install`
- Manually configuring `NEO4J_URI`, `NEO4J_DATABASE`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`

This is a critical gap — non-developer users cannot complete the setup without guidance.
The plugin must handle configuration automatically or guide users through it without
requiring developer tools or terminal knowledge.

Additionally, many non-developer users do not have a local Neo4j installation and should
not be required to install one. Alternative connection methods must be explored.

## Pre-requisites

- Neo4j schema is settled: `docs/architecture/neo4j-schema.md`

## Actions

### 13.1 Audit current Neo4j configuration

Find all places where Neo4j credentials are used or expected:

```bash
grep -r "NEO4J_" --include="*.ts" --include="*.js" grasp-it-plugin/
grep -r "\.env" --include="*.ts" --include="*.js" grasp-it-plugin/
```

Identify:
- Which packages expect `NEO4J_URI`, `NEO4J_DATABASE`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
- Whether `neo4j-driver` or another client is used
- Where the driver/client is initialized
- Whether any `.env` loading mechanism already exists

### 13.2 Design the configuration setup flow

Design a first-use configuration mechanism that:

1. **Detects existing configuration** — check for `.env` file or environment variables on
   startup
2. **Prompts user for missing values** — if credentials are missing, the plugin guides
   the user through entering them (suitable for Codex/ChatGPT context where interactive
   prompts work)
3. **Creates `.env` file** — writes `NEO4J_URI`, `NEO4J_DATABASE`, `NEO4J_USERNAME`,
   `NEO4J_PASSWORD` to a `.env` file in the project root
4. **Stores configuration per project** — each analyzed project gets its own `.env` in the
   project root (for project-specific credentials). For shared credentials (e.g. a team
   Neo4j instance), a global config at `~/.grasp-it/` can also be supported. Document
   the chosen approach.
5. **Never leaks credentials** — ensure credentials are not logged, exposed in prompts,
   or committed to git (add `.env` to `.gitignore` automatically)

Document the design decisions in a new section of
`docs/architecture/neo4j-schema.md` or a new file under `docs/architecture/`.

### 13.3 Implement `.env` auto-creation on first use

Implement the configuration setup flow from 13.2. The implementation should:

- Run on first invocation of any `/grasp-*` skill when configuration is missing
- Ask the user for each missing value via the skill's message interface
- Write the `.env` file with proper formatting
- Add `.env` to `.gitignore` in the project root
- Fall back to environment variables if `.env` is not preferred

### 13.4 Support Windows paths

Ensure paths used by the configuration system work on Windows:

- Use `path.join()` or equivalent for path construction
- Handle backslash vs forward slash in `.env` paths
- Test that `.env` creation works in a Windows-style project directory

### 13.5 Research and recommend alternative connection methods

Many non-developer users will not have a local Neo4j installation. Research and recommend
which alternative connection methods the plugin should support:

**Option A — Neo4j Aura (cloud) connection string**

- User provides a `neo4j+s://...` URI instead of a local path
- No local installation required
- Plugin treats it like any `NEO4J_URI` — minimal changes needed
- Document the Aura connection string format and how users obtain it

**Option B — MCP (Model Context Protocol) for Neo4j**

- MCP is a standard protocol for connecting LLMs to external data sources
- If Neo4j exposes an MCP server (or a third-party MCP->Neo4j bridge exists),
  the plugin could connect via MCP instead of direct driver
- Research: does Neo4j have an official MCP server? Does a community MCP->Neo4j
  bridge exist?
- Document the implementation approach and whether it requires additional dependencies

**Option C — Cypher shell / cypher-clie interface**

- `cypher-shell` is Neo4j's CLI for running Cypher queries
- The plugin could spawn `cypher-shell` as a subprocess for queries instead of using
  a driver directly
- This removes the need for a Neo4j driver in the plugin
- Research: is `cypher-shell` available on Windows? What is the installation story
  for non-developers?
- Document command syntax and Windows availability

For each option, provide:
- How it works technically
- Pros/cons for non-developer users
- Implementation effort (low/medium/high)
- Recommendation for which the plugin should support

### 13.6 Implement configurable connection type

After the research in 13.5, implement the connection type configuration:

- Add a `NEO4J_CONNECTION_TYPE` config value: `driver` (default), `mcp`, `cypher-shell`
- When `NEO4J_CONNECTION_TYPE=driver`, use the existing `neo4j-driver` approach
- When `NEO4J_CONNECTION_TYPE=mcp`, use the MCP protocol (implement the adapter)
- When `NEO4J_CONNECTION_TYPE=cypher-shell`, spawn `cypher-shell` subprocess
- The first-use setup should ask which connection type the user prefers

Document the configuration options in the setup flow.

## Completion

When complete:
- Non-developer users can configure Neo4j via guided prompts, no manual file editing required
- `.env` file is created automatically with all required variables
- `.env` is added to `.gitignore` automatically
- Windows paths are handled correctly
- At least one non-driver connection method (MCP or cypher-shell) is implemented
- `NEO4J_CONNECTION_TYPE` config option is documented
- Commit with message: `feat: add first-use Neo4j configuration for non-developer users`