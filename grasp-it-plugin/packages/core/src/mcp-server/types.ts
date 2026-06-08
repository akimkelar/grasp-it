/**
 * MCP Server Types
 *
 * Type definitions for the MCP server implementation.
 */

import type { GraphNode, GraphEdge, KnowledgeGraph } from "../types.js";

export interface MCPServerConfig {
  projectRoot: string;
  port?: number;
}

export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface MCPPaginatedResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface GraphResource {
  type: "node" | "edge" | "graph" | "meta";
  id: string;
  data: unknown;
}

export interface NodeSearchParams {
  query: string;
  types?: string[];
  limit?: number;
}

export interface NodeGetParams {
  nodeId: string;
}

export interface EdgeListParams {
  nodeId?: string;
  type?: string;
  limit?: number;
}

export interface GraphStatsParams {
  // Empty for now, but allows future filtering
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: Record<string, number>;
  edgeTypes: Record<string, number>;
  layers: string[];
}

export interface RunQueryParams {
  query: string;
  params?: Record<string, unknown>;
}

export interface RunQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  stats?: Record<string, number>;
}

export interface ProjectInfoParams {
  // No params needed
}

export interface ProjectInfo {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
  nodeCount: number;
  edgeCount: number;
  version: string;
}

export interface SchemaInfoParams {
  // No params needed
}

export interface NodeTypeInfo {
  type: string;
  properties: string[];
  description: string;
  example?: string;
}

export interface EdgeTypeInfo {
  type: string;
  direction: string;
  description: string;
  example?: string;
}

export interface SchemaInfo {
  nodeTypes: NodeTypeInfo[];
  edgeTypes: EdgeTypeInfo[];
  version: string;
}