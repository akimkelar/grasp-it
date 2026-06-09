import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createMCPServer } from "../mcp-server/index.js";
import type { KnowledgeGraph, GraphNode } from "../types.js";

vi.mock("../mcp-server/session.js", () => ({
  createNeo4jSession: vi.fn(),
}));

// Need to import after mock is set up
import { createNeo4jSession } from "../mcp-server/session.js";

function makeNode(overrides: Partial<GraphNode> & { id: string; name: string }): GraphNode {
  return {
    type: "file",
    summary: "",
    tags: [],
    complexity: "simple",
    ...overrides,
  };
}

function createSampleGraph(): KnowledgeGraph {
  return {
    version: "1.0",
    project: {
      name: "test-project",
      languages: ["TypeScript", "JavaScript"],
      frameworks: ["Express"],
      description: "A test project",
      analyzedAt: new Date().toISOString(),
      gitCommitHash: "abc123",
    },
    nodes: [
      makeNode({
        id: "auth-ctrl",
        name: "AuthenticationController",
        type: "class",
        summary: "Handles user login and authentication",
        tags: ["auth", "security"],
        filePath: "src/auth/controller.ts",
      }),
      makeNode({
        id: "user-model",
        name: "UserModel",
        type: "class",
        summary: "ORM model for users table",
        tags: ["model", "database"],
        filePath: "src/models/user.ts",
      }),
      makeNode({
        id: "login-fn",
        name: "login",
        type: "function",
        summary: "Authenticates user credentials",
        tags: ["auth", "login"],
        filePath: "src/auth/login.ts",
      }),
    ],
    edges: [
      {
        source: "auth-ctrl",
        target: "user-model",
        type: "imports",
        direction: "forward",
        weight: 0.8,
      },
      {
        source: "login-fn",
        target: "auth-ctrl",
        type: "calls",
        direction: "forward",
        weight: 0.9,
      },
    ],
    layers: [
      { id: "1", name: "Presentation", description: "UI layer", nodeIds: ["auth-ctrl"] },
      { id: "2", name: "Domain", description: "Business logic", nodeIds: ["login-fn"] },
    ],
    tour: [],
  };
}

function createMockSessionWithGraph(graph: KnowledgeGraph) {
  return {
    run: vi.fn(async (query: string) => {
      if (query.includes("MATCH (p:Project")) {
        return {
          records: [{
            name: graph.project.name,
            languages: graph.project.languages,
            frameworks: graph.project.frameworks,
            description: graph.project.description,
            analyzedAt: graph.project.analyzedAt,
            gitCommitHash: graph.project.gitCommitHash,
            version: graph.version,
          }],
        };
      }

      if (query.includes("MATCH (n:GraphNode)-[:PART_OF]->(p:Project")) {
        return {
          records: graph.nodes.map((node) => ({
            n: {
              id: node.id,
              name: node.name,
              type: node.type,
              summary: node.summary,
              filePath: node.filePath,
              lineRange: node.lineRange,
              tags: node.tags,
              complexity: node.complexity,
            },
          })),
        };
      }

      if (query.includes("MATCH (source:GraphNode)-[r:RELATES]->(target:GraphNode)")) {
        return {
          records: graph.edges.map((edge) => ({
            r: {
              source: edge.source,
              target: edge.target,
              type: edge.type,
              direction: edge.direction,
              description: edge.description,
              weight: edge.weight,
            },
          })),
        };
      }

      if (query.includes("MATCH (l:Layer)-[:PART_OF]->(p:Project")) {
        return {
          records: graph.layers.map((layer) => ({
            l: {
              id: layer.id,
              name: layer.name,
              description: layer.description,
              nodeIds: layer.nodeIds,
            },
          })),
        };
      }

      if (query.includes("MATCH (t:TourStep)-[:PART_OF]->(p:Project")) {
        return {
          records: graph.tour.map((step) => ({
            t: {
              order: step.order,
              title: step.title,
              description: step.description,
              nodeIds: step.nodeIds,
              languageLesson: step.languageLesson,
            },
          })),
        };
      }

      return { records: [] };
    }),
    close: vi.fn(),
  };
}

function createEmptyMockSession() {
  return {
    run: vi.fn(async () => ({ records: [] })),
    close: vi.fn(),
  };
}

describe("MCPServer", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "mcp-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    it("creates server with project root", () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      expect(server.getProjectRoot()).toBe(projectRoot);
    });

    it("handles initialize request", () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
      const result = response.result as { protocolVersion: string; serverInfo: { name: string; version: string } };
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.serverInfo.name).toBe("grasp-it");
      expect(result.serverInfo.version).toBe("0.1.0");
    });
  });

  describe("resources", () => {
    it("lists available resources", () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      });

      expect(response.result).toBeDefined();
      const result = response.result as { resources: Array<{ uri: string; name: string }> };
      expect(result.resources.length).toBeGreaterThan(0);
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain("grasp://graph");
      expect(uris).toContain("grasp://stats");
      expect(uris).toContain("grasp://schema");
    });

    it("returns empty graph stats when no graph exists", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "grasp://stats" },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { contents: Array<{ text: string }> };
      const stats = JSON.parse(result.contents[0].text);
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });

    it("returns graph stats when graph exists", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "grasp://stats" },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { contents: Array<{ text: string }> };
      const stats = JSON.parse(result.contents[0].text);
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
    });

    it("returns error for unknown resource", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "grasp://unknown" },
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain("Resource not found");
    });
  });

  describe("tools", () => {
    it("lists available tools", () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      expect(response.result).toBeDefined();
      const result = response.result as { tools: Array<{ name: string; description: string }> };
      expect(result.tools.length).toBeGreaterThan(0);
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain("search_nodes");
      expect(toolNames).toContain("get_node");
      expect(toolNames).toContain("list_edges");
      expect(toolNames).toContain("get_graph_stats");
      expect(toolNames).toContain("get_project_info");
      expect(toolNames).toContain("get_schema");
    });

    it("search_nodes returns error when no graph exists", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: { query: "auth" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No knowledge graph available");
    });

    it("search_nodes finds nodes in graph", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: { query: "auth" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBeGreaterThan(0);
      expect(parsed.results.some((r: { id: string }) => r.id === "auth-ctrl")).toBe(true);
    });

    it("get_node returns node details", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_node",
          arguments: { nodeId: "auth-ctrl" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.node.id).toBe("auth-ctrl");
      expect(parsed.node.name).toBe("AuthenticationController");
      expect(parsed.connections.length).toBeGreaterThan(0);
    });

    it("get_node returns error for unknown node", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_node",
          arguments: { nodeId: "unknown-node" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Node not found");
    });

    it("list_edges returns all edges", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_edges",
          arguments: {},
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(2);
      expect(parsed.edges.length).toBe(2);
    });

    it("list_edges filters by node", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_edges",
          arguments: { nodeId: "auth-ctrl" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(2);
      const edgeIds = parsed.edges.map((e: { source: string; target: string }) => `${e.source}-${e.target}`);
      expect(edgeIds).toContain("auth-ctrl-user-model");
      expect(edgeIds).toContain("login-fn-auth-ctrl");
    });

    it("get_graph_stats returns statistics", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_graph_stats",
          arguments: {},
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.nodeCount).toBe(3);
      expect(parsed.edgeCount).toBe(2);
      expect(parsed.nodeTypes.class).toBe(2);
      expect(parsed.nodeTypes.function).toBe(1);
      expect(parsed.layers).toContain("Presentation");
    });

    it("get_project_info returns project metadata", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_project_info",
          arguments: {},
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.name).toBe("test-project");
      expect(parsed.languages).toContain("TypeScript");
      expect(parsed.nodeCount).toBe(3);
      expect(parsed.edgeCount).toBe(2);
    });

    it("get_schema returns schema information", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_schema",
          arguments: {},
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.nodeTypes).toBeDefined();
      expect(parsed.edgeTypes).toBeDefined();
      expect(parsed.nodeTypes.length).toBeGreaterThan(0);
      expect(parsed.edgeTypes.length).toBeGreaterThan(0);
      expect(parsed.version).toBe("1.0");
    });

    it("returns error for unknown tool", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "unknown_tool",
          arguments: {},
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
    });

    it("handles method not found", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown/method",
        params: {},
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain("Method not found");
    });
  });

  describe("refresh", () => {
    it("reloads graph after refresh", async () => {
      const graph = createSampleGraph();
      const mockSession = createMockSessionWithGraph(graph);
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: true,
        session: mockSession,
      });

      const server = createMCPServer({ projectRoot });

      // Initial search
      let response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: { query: "auth" },
        },
      });
      let result = response.result as { content: Array<{ text: string }> };
      expect(JSON.parse(result.content[0].text).total).toBeGreaterThan(0);

      // Refresh - creates new MCPResources and MCPTools
      server.refresh();

      // Search again - should still work (refresh creates new instances)
      response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "search_nodes",
          arguments: { query: "auth" },
        },
      });
      result = response.result as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBeGreaterThan(0);
    });
  });

  describe("handleRequestAsync", () => {
    it("handles async tool call for run_query", async () => {
      vi.mocked(createNeo4jSession).mockResolvedValue({
        success: false,
        session: undefined,
      });

      const server = createMCPServer({ projectRoot });

      // This should return an error since there's no Neo4j config
      const response = await server.handleRequestAsync({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "run_query",
          arguments: { query: "MATCH (n) RETURN n" },
        },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No Neo4j configuration found");
    });
  });
});