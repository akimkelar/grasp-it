/**
 * Neo4j Session Helper for MCP Server
 *
 * Creates Neo4j sessions from project configuration.
 */

import { loadConfig } from "../neo4j-config.js";

export interface Neo4jSessionResult {
  success: boolean;
  session?: {
    run: (query: string, params: Record<string, unknown>) => Promise<{ records: unknown[] }>;
    close: () => Promise<void>;
  };
  error?: string;
}

/**
 * Create a Neo4j session for the given project root.
 * Returns a session object with a `run` method compatible with the persistence layer.
 */
export async function createNeo4jSession(
  projectRoot: string,
): Promise<Neo4jSessionResult> {
  const configResult = loadConfig(projectRoot);

  if (!configResult.success || !configResult.config) {
    return {
      success: false,
      error: configResult.error ?? "No Neo4j configuration found",
    };
  }

  const config = configResult.config;

  if (config.connectionType === "mcp") {
    return {
      success: false,
      error: "MCP connection is not yet supported for MCP server",
    };
  }

  if (config.connectionType === "cypher-shell") {
    return {
      success: false,
      error: "cypher-shell connection is not supported for MCP server",
    };
  }

  try {
    const { default: neo4j } = await import("neo4j-driver");
    const driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
    );

    const session = driver.session();

    return {
      success: true,
      session: {
        run: async (query: string, params: Record<string, unknown>) => {
          const result = await session.run(query, params);
          return { records: result.records };
        },
        close: async () => {
          await session.close();
          await driver.close();
        },
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to create Neo4j session: ${error}`,
    };
  }
}