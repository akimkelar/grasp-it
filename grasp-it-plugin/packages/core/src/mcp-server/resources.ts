/**
 * MCP Resources Provider
 *
 * Provides knowledge graph data as MCP resources.
 */

import type { KnowledgeGraph, GraphNode, GraphEdge } from "../types.js";
import { loadGraph } from "../persistence/index.js";
import type {
  MCPResource,
  MCPResourceContent,
  GraphStats,
  ProjectInfo,
  SchemaInfo,
  NodeTypeInfo,
  EdgeTypeInfo,
} from "./types.js";

const GRAPH_URI = "grasp://graph";
const NODES_URI = "grasp://nodes";
const META_URI = "grasp://meta";
const STATS_URI = "grasp://stats";
const SCHEMA_URI = "grasp://schema";

const NODE_KINDS = ["codebase", "knowledge", "project"] as const;
const NODE_TYPE_DESCRIPTIONS: Record<string, string> = {
  file: "Source code file",
  function: "Function or method",
  class: "Class or struct",
  module: "Module or namespace",
  concept: "Conceptual entity",
  config: "Configuration file",
  document: "Documentation file",
  service: "Service or microservice",
  table: "Database table",
  endpoint: "API endpoint",
  pipeline: "Data pipeline",
  schema: "Database schema",
  resource: "Infrastructure resource",
  domain: "Business domain",
  feature: "Feature or capability",
  operation: "Business operation",
  actor: "Actor or user role",
  "business-rule": "Business rule",
  entity: "Business entity",
  article: "Wiki article",
  topic: "Knowledge topic",
  claim: "Knowledge claim",
  source: "Information source",
  decision: "Architecture decision",
  constraint: "System constraint",
  risk: "Project risk",
};

const EDGE_TYPE_DESCRIPTIONS: Record<string, string> = {
  imports: "Imports dependencies",
  exports: "Exports public API",
  contains: "Contains child elements",
  inherits: "Inherits from parent",
  implements: "Implements interface",
  calls: "Calls method",
  subscribes: "Subscribes to events",
  publishes: "Publishes events",
  middleware: "Middleware in chain",
  reads_from: "Reads data from",
  writes_to: "Writes data to",
  transforms: "Transforms data",
  validates: "Validates input",
  depends_on: "Depends on",
  tested_by: "Tested by",
  configures: "Configures",
  related: "Related to",
  similar_to: "Similar to",
  deploys: "Deploys to",
  serves: "Serves content",
  provisions: "Provisions resource",
  triggers: "Triggers action",
  migrates: "Migrates schema",
  documents: "Documents entity",
  routes: "Routes requests",
  defines_schema: "Defines schema",
  has_feature: "Has feature",
  has_operation: "Has operation",
  sequence: "Follows sequence",
  performed_by: "Performed by",
  restricted_for: "Restricted for",
  governs: "Governs rules",
  uses_entity: "Uses entity",
  implemented_by: "Implemented by",
  cites: "Cites source",
  contradicts: "Contradicts claim",
  builds_on: "Builds on",
  exemplifies: "Exemplifies concept",
  categorized_under: "Categorized under",
  authored_by: "Authored by",
  decides: "Decides",
  constrained_by: "Constrained by",
  supports: "Supports",
  applies_in: "Applies in",
  sub_concept_of: "Sub-concept of",
  has_risk: "Has risk",
  mitigated_by: "Mitigated by",
};

function getNodeTypeDescription(type: string): string {
  return NODE_TYPE_DESCRIPTIONS[type] ?? "Graph node";
}

function getEdgeTypeDescription(type: string): string {
  return EDGE_TYPE_DESCRIPTIONS[type] ?? "Graph edge";
}

export class MCPResources {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private loadGraphData(): KnowledgeGraph | null {
    return loadGraph(this.projectRoot, { validate: false });
  }

  listResources(): MCPResource[] {
    return [
      {
        uri: GRAPH_URI,
        name: "Knowledge Graph",
        description: "Full knowledge graph with all nodes, edges, and metadata",
        mimeType: "application/json",
      },
      {
        uri: NODES_URI,
        name: "Graph Nodes",
        description: "All nodes in the knowledge graph",
        mimeType: "application/json",
      },
      {
        uri: META_URI,
        name: "Analysis Metadata",
        description: "Project metadata and analysis info",
        mimeType: "application/json",
      },
      {
        uri: STATS_URI,
        name: "Graph Statistics",
        description: "Statistics about the knowledge graph",
        mimeType: "application/json",
      },
      {
        uri: SCHEMA_URI,
        name: "Graph Schema",
        description: "Schema information about node and edge types",
        mimeType: "application/json",
      },
    ];
  }

  readResource(uri: string): MCPResourceContent | null {
    const graph = this.loadGraphData();

    switch (uri) {
      case GRAPH_URI:
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(graph, null, 2),
        };

      case NODES_URI:
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(graph?.nodes ?? [], null, 2),
        };

      case META_URI:
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(graph?.project ?? null, null, 2),
        };

      case STATS_URI:
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(this.computeStats(graph), null, 2),
        };

      case SCHEMA_URI:
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(this.computeSchema(graph), null, 2),
        };

      default:
        return null;
    }
  }

  computeStats(graph: KnowledgeGraph | null): GraphStats {
    if (!graph) {
      return {
        nodeCount: 0,
        edgeCount: 0,
        nodeTypes: {},
        edgeTypes: {},
        layers: [],
      };
    }

    const nodeTypes: Record<string, number> = {};
    const edgeTypes: Record<string, number> = {};
    const layers: string[] = [];

    for (const node of graph.nodes) {
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }

    for (const edge of graph.edges) {
      edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
    }

    for (const layer of graph.layers) {
      if (!layers.includes(layer.name)) {
        layers.push(layer.name);
      }
    }

    return {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypes,
      edgeTypes,
      layers,
    };
  }

  computeSchema(_graph: KnowledgeGraph | null): SchemaInfo {
    const nodeTypes: NodeTypeInfo[] = Object.keys(NODE_TYPE_DESCRIPTIONS).map((type) => ({
      type,
      properties: getNodeProperties(type),
      description: NODE_TYPE_DESCRIPTIONS[type],
    }));

    const edgeTypes: EdgeTypeInfo[] = Object.keys(EDGE_TYPE_DESCRIPTIONS).map((type) => ({
      type,
      direction: "directed",
      description: EDGE_TYPE_DESCRIPTIONS[type],
    }));

    return {
      nodeTypes,
      edgeTypes,
      version: "1.0",
    };
  }

  getNode(nodeId: string): GraphNode | null {
    const graph = this.loadGraphData();
    if (!graph) return null;

    return graph.nodes.find((n) => n.id === nodeId) ?? null;
  }

  getNodeByUri(uri: string): GraphNode | null {
    if (!uri.startsWith("grasp://node/")) return null;
    const nodeId = uri.slice("grasp://node/".length);
    return this.getNode(nodeId);
  }

  getEdgesForNode(nodeId: string): GraphEdge[] {
    const graph = this.loadGraphData();
    if (!graph) return [];

    return graph.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  }

  getProjectInfo(): ProjectInfo | null {
    const graph = this.loadGraphData();
    if (!graph?.project) return null;

    return {
      name: graph.project.name,
      languages: graph.project.languages,
      frameworks: graph.project.frameworks,
      description: graph.project.description,
      analyzedAt: graph.project.analyzedAt,
      gitCommitHash: graph.project.gitCommitHash,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      version: graph.version,
    };
  }
}

function getNodeProperties(type: string): string[] {
  const baseProps = ["id", "type", "name", "summary", "tags", "complexity"];

  switch (type) {
    case "file":
      return [...baseProps, "filePath", "analyzedAtCommit"];
    case "function":
    case "class":
      return [...baseProps, "filePath", "lineRange"];
    case "domain":
      return [...baseProps, "domainMeta"];
    case "article":
    case "topic":
    case "claim":
    case "source":
      return [...baseProps, "knowledgeMeta"];
    case "decision":
      return [...baseProps, "rationale", "status", "scope"];
    case "constraint":
      return [...baseProps, "condition", "invariant", "scope"];
    case "risk":
      return [...baseProps, "severity", "probability", "mitigation"];
    default:
      return baseProps;
  }
}