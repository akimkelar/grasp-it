# Neo4j Test Configuration

When running tests that require Neo4j connection, use:

```bash
NEO4J_URI=neo4j://127.0.0.1:7687 \
NEO4J_DATABASE=grasp \
NEO4J_USERNAME=neo4j \
NEO4J_PASSWORD=testneo4j \
pnpm test
```

**Important:** The database is `grasp` (not `neo4j`).

## Common Issues

### Tests expecting "no Neo4j config" fail when env vars are set
Tests like `test_run_query.test.mjs` that check for graceful skip when no Neo4j is configured will fail if `NEO4J_*` env vars are set. This is expected behavior - either unset the vars or skip those specific tests.

### Build fails with MCP server type error
If you see `TS2739: Type 'Promise<MCPResourceContent | null>' is missing properties` in `mcp-server/server.ts`, the MCP server needs to be updated to use `loadGraphFromNeo4j` instead of the removed `loadGraph` function.
