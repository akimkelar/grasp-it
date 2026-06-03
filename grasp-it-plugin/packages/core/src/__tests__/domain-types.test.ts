import { describe, it, expect } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

const domainGraph: KnowledgeGraph = {
  version: "1.0.0",
  project: {
    name: "test-project",
    languages: ["typescript"],
    frameworks: [],
    description: "A test project",
    analyzedAt: "2026-04-01T00:00:00.000Z",
    gitCommitHash: "abc123",
  },
  nodes: [
    {
      id: "domain:order-management",
      type: "domain",
      name: "Order Management",
      summary: "Handles order lifecycle",
      tags: ["core"],
      complexity: "complex",
    },
    {
      id: "feature:create-order",
      type: "feature",
      name: "Create Order",
      summary: "Customer submits a new order",
      tags: ["write-path"],
      complexity: "moderate",
      status: "implemented",
    },
    {
      id: "operation:validate-order",
      type: "operation",
      name: "Validate Order",
      summary: "Checks request body",
      tags: ["validation"],
      complexity: "simple",
    },
    {
      id: "actor:customer",
      type: "actor",
      name: "Customer",
      summary: "End user placing orders",
      tags: ["user"],
      complexity: "simple",
      permissions: ["place-order"],
      restrictions: [],
    },
    {
      id: "business-rule:manager-approval",
      type: "business-rule",
      name: "Manager Approval Required",
      summary: "Orders over $1000 require manager approval",
      tags: ["approval"],
      complexity: "simple",
      ruleText: "Orders exceeding $1000 must be approved by a manager",
      status: "active",
    },
    {
      id: "entity:order",
      type: "entity",
      name: "Order",
      summary: "Customer order record",
      tags: ["core"],
      complexity: "moderate",
    },
  ],
  edges: [
    {
      source: "domain:order-management",
      target: "feature:create-order",
      type: "has_feature",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "feature:create-order",
      target: "operation:validate-order",
      type: "has_operation",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "operation:validate-order",
      target: "actor:customer",
      type: "performed_by",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "business-rule:manager-approval",
      target: "feature:create-order",
      type: "governs",
      direction: "forward",
      weight: 0.8,
    },
    {
      source: "feature:create-order",
      target: "entity:order",
      type: "uses_entity",
      direction: "forward",
      weight: 0.6,
    },
  ],
  layers: [],
  tour: [],
};

describe("domain graph types", () => {
  it("validates a domain graph with domain/feature/operation node types", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes).toHaveLength(6);
    expect(result.data!.edges).toHaveLength(5);
  });

  it("validates has_feature edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].type).toBe("has_feature");
  });

  it("validates has_operation edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[1].type).toBe("has_operation");
  });

  it("validates performed_by edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[2].type).toBe("performed_by");
  });

  it("validates governs edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[3].type).toBe("governs");
  });

  it("validates uses_entity edge type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    expect(result.data!.edges[4].type).toBe("uses_entity");
  });

  it("validates actor node type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    const actorNode = result.data!.nodes.find((n) => n.id === "actor:customer");
    expect(actorNode).toBeDefined();
    expect((actorNode as any).permissions).toEqual(["place-order"]);
  });

  it("validates business-rule node type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    const brNode = result.data!.nodes.find((n) => n.id === "business-rule:manager-approval");
    expect(brNode).toBeDefined();
    expect((brNode as any).ruleText).toContain("$1000");
    expect(brNode!.status).toBe("active");
  });

  it("validates entity node type", () => {
    const result = validateGraph(domainGraph);
    expect(result.success).toBe(true);
    const entityNode = result.data!.nodes.find((n) => n.id === "entity:order");
    expect(entityNode).toBeDefined();
  });

  it("validates sequence edge type", () => {
    const graph = structuredClone(domainGraph);
    graph.edges.push({
      source: "operation:validate-order",
      target: "operation:validate-order",
      type: "sequence",
      direction: "forward",
      weight: 0.5,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
  });

  it("validates restricted_for edge type", () => {
    const graph = structuredClone(domainGraph);
    graph.edges.push({
      source: "operation:validate-order",
      target: "actor:customer",
      type: "restricted_for",
      direction: "forward",
      weight: 1.0,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
  });

  it("validates implemented_by edge type", () => {
    const graph = structuredClone(domainGraph);
    graph.edges.push({
      source: "feature:create-order",
      target: "file:src/orders.ts",
      type: "implemented_by",
      direction: "forward",
      weight: 0.8,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
  });

  it("validates feature status values", () => {
    const graph = structuredClone(domainGraph);
    (graph.nodes[1] as any).status = "planned";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[1].status).toBe("planned");
  });

  it("normalizes domain type alias", () => {
    const graph = structuredClone(domainGraph);
    (graph.nodes[0] as any).type = "business_domain";
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0].type).toBe("domain");
  });
});
