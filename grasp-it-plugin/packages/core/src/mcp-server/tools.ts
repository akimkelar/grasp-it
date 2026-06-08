/**
 * MCP Tools Provider
 *
 * Provides tools for querying and searching the knowledge graph.
 */

import { loadGraph } from "../persistence/index.js";
import { SearchEngine, type SearchOptions } from "../search.js";
import { loadConfig } from "../neo4j-config.js";
import type { GraphNode } from "../types.js";
import type {
  MCPTool,
  MCPToolResult,
  NodeSearchParams,
  NodeGetParams,
  EdgeListParams,
  GraphStatsParams,
  RunQueryParams,
  ProjectInfoParams,
  SchemaInfoParams,
} from "./types.js";
import { MCPResources } from "./resources.js";

export class MCPTools {
  private projectRoot: string;
  private resources: MCPResources;
  private searchEngine: SearchEngine | null = null;
  private cachedNodes: GraphNode[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.resources = new MCPResources(projectRoot);
    this.initializeSearchEngine();
  }

  private initializeSearchEngine(): void {
    const graph = loadGraph(this.projectRoot, { validate: false });
    if (graph?.nodes) {
      this.cachedNodes = graph.nodes;
      this.searchEngine = new SearchEngine(graph.nodes);
    }
  }

  listTools(): MCPTool[] {
    return [
      {
        name: "search_nodes",
        description: "Search for nodes in the knowledge graph using fuzzy text search",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query text",
            },
            types: {
              type: "array",
              items: { type: "string" },
              description: "Optional filter for node types (e.g., ['function', 'class'])",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 50)",
              default: 50,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_node",
        description: "Get detailed information about a specific node by ID",
        inputSchema: {
          type: "object",
          properties: {
            nodeId: {
              type: "string",
              description: "The node ID to retrieve",
            },
          },
          required: ["nodeId"],
        },
      },
      {
        name: "list_edges",
        description: "List edges in the knowledge graph, optionally filtered by node or type",
        inputSchema: {
          type: "object",
          properties: {
            nodeId: {
              type: "string",
              description: "Optional node ID to filter edges (returns edges connected to this node)",
            },
            type: {
              type: "string",
              description: "Optional edge type filter (e.g., 'calls', 'imports')",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 100)",
              default: 100,
            },
          },
        },
      },
      {
        name: "get_graph_stats",
        description: "Get statistics about the knowledge graph (node counts, type distributions, layers)",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_project_info",
        description: "Get project metadata and analysis information",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_schema",
        description: "Get the schema information about node and edge types",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "run_query",
        description: "Execute a Cypher query against the Neo4j database (requires Neo4j configuration)",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The Cypher query to execute",
            },
          },
          required: ["query"],
        },
      },
    ];
  }

  callTool(toolName: string, args: Record<string, unknown>): MCPToolResult {
    switch (toolName) {
      case "search_nodes":
        return this.searchNodes(args as unknown as NodeSearchParams);
      case "get_node":
        return this.getNode(args as unknown as NodeGetParams);
      case "list_edges":
        return this.listEdges(args as unknown as EdgeListParams);
      case "get_graph_stats":
        return this.getGraphStats(args as unknown as GraphStatsParams);
      case "get_project_info":
        return this.getProjectInfo(args as unknown as ProjectInfoParams);
      case "get_schema":
        return this.getSchema(args as unknown as SchemaInfoParams);
      case "run_query":
        return {
          content: [{ type: "text", text: "run_query is async - use callToolAsync instead" }],
          isError: true,
        };
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
    }
  }

  async callToolAsync(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    switch (toolName) {
      case "run_query":
        return this.runQuery(args as unknown as RunQueryParams);
      default:
        return this.callTool(toolName, args);
    }
  }

  private searchNodes(params: NodeSearchParams): MCPToolResult {
    if (!this.searchEngine) {
      return {
        content: [{ type: "text", text: "No knowledge graph available. Run /grasp first." }],
        isError: true,
      };
    }

    const { query, types, limit = 50 } = params;

    const options: SearchOptions = {};
    if (types && types.length > 0) {
      options.types = types as GraphNode["type"][];
    }
    options.limit = limit;

    const results = this.searchEngine.search(query, options);

    const matchedNodes = results
      .map((r) => this.cachedNodes.find((n) => n.id === r.nodeId))
      .filter((n): n is GraphNode => n !== undefined);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query: query,
              results: matchedNodes.map((n) => ({
                id: n.id,
                type: n.type,
                name: n.name,
                summary: n.summary,
                tags: n.tags,
                filePath: n.filePath,
                score: results.find((r) => r.nodeId === n.id)?.score ?? 0,
              })),
              total: matchedNodes.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private getNode(params: NodeGetParams): MCPToolResult {
    const node = this.resources.getNode(params.nodeId);

    if (!node) {
      return {
        content: [{ type: "text", text: `Node not found: ${params.nodeId}` }],
        isError: true,
      };
    }

    const edges = this.resources.getEdgesForNode(params.nodeId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              node,
              connections: edges.map((e) => ({
                type: e.type,
                direction: e.direction,
                target: e.source === params.nodeId ? e.target : e.source,
                description: e.description,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private listEdges(params: EdgeListParams): MCPToolResult {
    const graph = loadGraph(this.projectRoot, { validate: false });
    if (!graph) {
      return {
        content: [{ type: "text", text: "No knowledge graph available. Run /grasp first." }],
        isError: true,
      };
    }

    let edges = graph.edges;

    if (params.nodeId) {
      edges = edges.filter((e) => e.source === params.nodeId || e.target === params.nodeId);
    }

    if (params.type) {
      edges = edges.filter((e) => e.type === params.type);
    }

    const limit = params.limit ?? 100;
    edges = edges.slice(0, limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              edges: edges.map((e) => ({
                source: e.source,
                target: e.target,
                type: e.type,
                direction: e.direction,
                description: e.description,
                weight: e.weight,
              })),
              total: edges.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private getGraphStats(_params: GraphStatsParams): MCPToolResult {
    const graph = loadGraph(this.projectRoot, { validate: false });
    const stats = this.resources.computeStats(graph);

    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
    };
  }

  private getProjectInfo(_params: ProjectInfoParams): MCPToolResult {
    const info = this.resources.getProjectInfo();

    if (!info) {
      return {
        content: [{ type: "text", text: "No project info available. Run /grasp first." }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  }

  private getSchema(_params: SchemaInfoParams): MCPToolResult {
    const graph = loadGraph(this.projectRoot, { validate: false });
    const schema = this.resources.computeSchema(graph);

    return {
      content: [{ type: "text", text: JSON.stringify(schema, null, 2) }],
    };
  }

  private async runQuery(params: RunQueryParams): Promise<MCPToolResult> {
    const configResult = loadConfig(this.projectRoot);

    if (!configResult.success || !configResult.config) {
      return {
        content: [{ type: "text", text: "No Neo4j configuration found. Set up Neo4j first." }],
        isError: true,
      };
    }

    const config = configResult.config;

    if (config.connectionType === "mcp") {
      return {
        content: [{ type: "text", text: "MCP connection is not yet supported for direct queries." }],
        isError: true,
      };
    }

    if (config.connectionType === "cypher-shell") {
      return {
        content: [{ type: "text", text: "cypher-shell connection requires running the query via shell. Use the run-query.mjs script instead." }],
        isError: true,
      };
    }

    try {
      const { default: neo4j } = await import("neo4j-driver");
      const driver = neo4j.driver(
        config.uri,
        neo4j.auth.basic(config.username, config.password),
      );

      const session = driver.session();
      const result = await session.run(params.query, params.params ?? {});

      const records: Record<string, unknown>[] = [];
      let columns: string[] = [];

      result.records.forEach((record, idx) => {
        const obj: Record<string, unknown> = {};
        const keys = record.keys;
        if (idx === 0) {
          columns = Array.from(keys).map(String);
        }
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const value = record.get(key);
          obj[String(key)] = convertNeo4jValue(value);
        }
        records.push(obj);
      });

      await session.close();
      await driver.close();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                columns,
                rows: records,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Query failed: ${error}` }],
        isError: true,
      };
    }
  }
}

function convertNeo4jValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map(convertNeo4jValue);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("toString" in value && typeof (value as { toString: () => string }).toString === "function") {
      const ctorName = value.constructor?.name;
      if (ctorName && !["String", "Number", "Boolean", "Array", "Object"].includes(ctorName)) {
        return (value as { toString: () => string }).toString();
      }
    }
    const converted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      converted[k] = convertNeo4jValue(v);
    }
    return converted;
  }

  return String(value);
}