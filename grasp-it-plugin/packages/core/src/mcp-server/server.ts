/**
 * MCP Server
 *
 * Model Context Protocol server implementation for grasp-it.
 * Exposes the knowledge graph as MCP resources and tools.
 */

import type {
  MCPRequest,
  MCPResponse,
  MCPResource,
  MCPResourceContent,
  MCPTool,
} from "./types.js";
import { MCPResources } from "./resources.js";
import { MCPTools } from "./tools.js";

export interface MCPServerOptions {
  projectRoot: string;
}

export class MCPServer {
  private resources: MCPResources;
  private tools: MCPTools;
  private projectRoot: string;

  constructor(options: MCPServerOptions) {
    this.projectRoot = options.projectRoot;
    this.resources = new MCPResources(options.projectRoot);
    this.tools = new MCPTools(options.projectRoot);
  }

  handleRequest(request: MCPRequest): MCPResponse {
    try {
      const result = this.processRequest(request);
      if (result instanceof Promise) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message: "Async methods not supported in sync handleRequest",
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async handleRequestAsync(request: MCPRequest): Promise<MCPResponse> {
    try {
      const result = await this.processRequestAsync(request);
      return {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private processRequest(request: MCPRequest): unknown {
    const { method, params } = request;

    if (method === "initialize") {
      return this.handleInitialize(params);
    }

    if (method === "resources/list") {
      return this.handleResourcesList();
    }

    if (method === "resources/read") {
      return this.handleResourcesRead(params);
    }

    if (method === "tools/list") {
      return this.handleToolsList();
    }

    if (method === "tools/call") {
      return this.handleToolsCallSync(params);
    }

    throw new Error(`Method not found: ${method}`);
  }

  private async processRequestAsync(request: MCPRequest): Promise<unknown> {
    const { method, params } = request;

    if (method === "initialize") {
      return this.handleInitialize(params);
    }

    if (method === "resources/list") {
      return this.handleResourcesList();
    }

    if (method === "resources/read") {
      return this.handleResourcesRead(params);
    }

    if (method === "tools/list") {
      return this.handleToolsList();
    }

    if (method === "tools/call") {
      return await this.handleToolsCallAsync(params);
    }

    throw new Error(`Method not found: ${method}`);
  }

  private handleInitialize(params?: Record<string, unknown>): {
    protocolVersion: string;
    capabilities: { resources: { subscribe: boolean; list: boolean }; tools: { list: boolean; call: boolean } };
    serverInfo: { name: string; version: string };
  } {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        resources: {
          subscribe: false,
          list: true,
        },
        tools: {
          list: true,
          call: true,
        },
      },
      serverInfo: {
        name: "grasp-it",
        version: "0.1.0",
      },
    };
  }

  private handleResourcesList(): { resources: MCPResource[] } {
    return {
      resources: this.resources.listResources(),
    };
  }

  private async handleResourcesRead(params?: Record<string, unknown>): Promise<{ contents: MCPResourceContent[] }> {
    const uri = params?.uri as string;
    if (!uri) {
      throw new Error("uri parameter is required");
    }

    const content = await this.resources.readResource(uri);
    if (!content) {
      throw new Error(`Resource not found: ${uri}`);
    }

    return {
      contents: [content],
    };
  }

  private handleToolsList(): { tools: MCPTool[] } {
    return {
      tools: this.tools.listTools(),
    };
  }

  private handleToolsCallSync(params?: Record<string, unknown>): unknown {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};

    if (!name) {
      throw new Error("name parameter is required");
    }

    return this.tools.callTool(name, args);
  }

  private async handleToolsCallAsync(params?: Record<string, unknown>): Promise<unknown> {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};

    if (!name) {
      throw new Error("name parameter is required");
    }

    return this.tools.callToolAsync(name, args);
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  refresh(): void {
    this.resources = new MCPResources(this.projectRoot);
    this.tools = new MCPTools(this.projectRoot);
  }
}

export function createMCPServer(options: MCPServerOptions): MCPServer {
  return new MCPServer(options);
}