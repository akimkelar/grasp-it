import { describe, it, expect } from "vitest";
import { validateGraph } from "../schema.js";
import type { KnowledgeGraph } from "../types.js";

// Fixture: a minimal but complete knowledge graph exercising all new node types
const knowledgeGraph: KnowledgeGraph = {
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
      id: "domain:invoicing",
      type: "domain",
      name: "Invoicing",
      summary: "Handles invoicing lifecycle",
      tags: ["core"],
      complexity: "complex",
    },
    {
      id: "feature:invoice-assignment",
      type: "feature",
      name: "Invoice Assignment",
      summary: "Assign invoices to managers",
      tags: ["write-path"],
      complexity: "moderate",
      status: "planned",
    },
    {
      id: "operation:assign-invoice",
      type: "operation",
      name: "Assign Invoice",
      summary: "Assigns an invoice to a manager",
      tags: ["assignment"],
      complexity: "simple",
      status: "implemented",
    },
    {
      id: "actor:manager",
      type: "actor",
      name: "Manager",
      summary: "Department manager",
      tags: ["user"],
      complexity: "simple",
      permissions: ["approve-invoice"],
      restrictions: [],
    },
    {
      id: "entity:invoice",
      type: "entity",
      name: "Invoice",
      summary: "Invoice record",
      tags: ["core"],
      complexity: "moderate",
    },
    {
      id: "business-rule:manager-approval",
      type: "business-rule",
      name: "Manager Approval Required",
      summary: "Invoices over $1000 require approval",
      tags: ["approval"],
      complexity: "simple",
      ruleText: "Invoices exceeding $1000 must be approved by a manager",
      status: "active",
    },
  ],
  edges: [
    {
      source: "domain:invoicing",
      target: "feature:invoice-assignment",
      type: "has_feature",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "feature:invoice-assignment",
      target: "operation:assign-invoice",
      type: "has_operation",
      direction: "forward",
      weight: 1.0,
    },
    {
      source: "operation:assign-invoice",
      target: "actor:manager",
      type: "performed_by",
      direction: "forward",
      weight: 0.9,
    },
    {
      source: "operation:assign-invoice",
      target: "entity:invoice",
      type: "uses_entity",
      direction: "forward",
      weight: 0.9,
    },
    {
      source: "business-rule:manager-approval",
      target: "feature:invoice-assignment",
      type: "governs",
      direction: "forward",
      weight: 0.8,
    },
  ],
  layers: [],
  tour: [],
};

describe("knowledge node types", () => {
  it("validates a complete knowledge subgraph", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.nodes).toHaveLength(6);
    expect(result.data!.edges).toHaveLength(5);
  });

  it("validates feature node type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const featureNode = result.data!.nodes.find((n) => n.id === "feature:invoice-assignment");
    expect(featureNode).toBeDefined();
    expect(featureNode!.type).toBe("feature");
    expect((featureNode as any).status).toBe("planned");
  });

  it("validates actor node type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const actorNode = result.data!.nodes.find((n) => n.id === "actor:manager");
    expect(actorNode).toBeDefined();
    expect(actorNode!.type).toBe("actor");
    expect((actorNode as any).permissions).toEqual(["approve-invoice"]);
    expect((actorNode as any).restrictions).toEqual([]);
  });

  it("validates operation node type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const opNode = result.data!.nodes.find((n) => n.id === "operation:assign-invoice");
    expect(opNode).toBeDefined();
    expect(opNode!.type).toBe("operation");
    expect((opNode as any).status).toBe("implemented");
  });

  it("validates entity node type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const entityNode = result.data!.nodes.find((n) => n.id === "entity:invoice");
    expect(entityNode).toBeDefined();
    expect(entityNode!.type).toBe("entity");
  });

  it("validates business-rule node type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const brNode = result.data!.nodes.find((n) => n.id === "business-rule:manager-approval");
    expect(brNode).toBeDefined();
    expect(brNode!.type).toBe("business-rule");
    expect((brNode as any).ruleText).toContain("$1000");
    expect(brNode!.status).toBe("active");
  });

  it("validates has_feature edge type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "has_feature");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("domain:invoicing");
    expect(edge!.target).toBe("feature:invoice-assignment");
  });

  it("validates has_operation edge type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "has_operation");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("feature:invoice-assignment");
    expect(edge!.target).toBe("operation:assign-invoice");
  });

  it("validates sequence edge type", () => {
    const graph = structuredClone(knowledgeGraph);
    graph.edges.push({
      source: "operation:assign-invoice",
      target: "operation:assign-invoice",
      type: "sequence",
      direction: "forward",
      weight: 0.5,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    const seqEdge = result.data!.edges.find((e) => e.type === "sequence");
    expect(seqEdge).toBeDefined();
  });

  it("validates performed_by edge type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "performed_by");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("operation:assign-invoice");
    expect(edge!.target).toBe("actor:manager");
  });

  it("validates restricted_for edge type", () => {
    const graph = structuredClone(knowledgeGraph);
    graph.edges.push({
      source: "operation:assign-invoice",
      target: "actor:manager",
      type: "restricted_for",
      direction: "forward",
      weight: 1.0,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "restricted_for");
    expect(edge).toBeDefined();
  });

  it("validates governs edge type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "governs");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("business-rule:manager-approval");
    expect(edge!.target).toBe("feature:invoice-assignment");
  });

  it("validates uses_entity edge type", () => {
    const result = validateGraph(knowledgeGraph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "uses_entity");
    expect(edge).toBeDefined();
    expect(edge!.source).toBe("operation:assign-invoice");
    expect(edge!.target).toBe("entity:invoice");
  });

  it("validates implemented_by edge type", () => {
    const graph = structuredClone(knowledgeGraph);
    // Add a file node so implemented_by edge target exists
    graph.nodes.push({
      id: "file:src/invoicing/assign.ts",
      type: "file",
      name: "assign.ts",
      filePath: "src/invoicing/assign.ts",
      summary: "Invoice assignment logic",
      tags: ["invoicing"],
      complexity: "moderate",
    });
    graph.edges.push({
      source: "feature:invoice-assignment",
      target: "file:src/invoicing/assign.ts",
      type: "implemented_by",
      direction: "forward",
      weight: 0.8,
    });
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    const edge = result.data!.edges.find((e) => e.type === "implemented_by");
    expect(edge).toBeDefined();
  });

  describe("status values", () => {
    it("feature status values: planned, partial, implemented are valid", () => {
      for (const status of ["planned", "partial", "implemented"]) {
        const graph = structuredClone(knowledgeGraph);
        const featureNode = graph.nodes.find((n) => n.id === "feature:invoice-assignment") as any;
        featureNode.status = status;
        const result = validateGraph(graph);
        expect(result.success).toBe(true);
        expect(result.data!.nodes.find((n) => n.id === "feature:invoice-assignment")!.status).toBe(status);
      }
    });

    it("business-rule status values: active, deprecated, proposed are valid", () => {
      for (const status of ["active", "deprecated", "proposed"]) {
        const graph = structuredClone(knowledgeGraph);
        const brNode = graph.nodes.find((n) => n.id === "business-rule:manager-approval") as any;
        brNode.status = status;
        const result = validateGraph(graph);
        expect(result.success).toBe(true);
        expect(result.data!.nodes.find((n) => n.id === "business-rule:manager-approval")!.status).toBe(status);
      }
    });

    it("decision status values: draft, accepted, deprecated are valid", () => {
      const decisionGraph: KnowledgeGraph = {
        ...knowledgeGraph,
        nodes: [
          ...knowledgeGraph.nodes,
          {
            id: "decision:budget-approval",
            type: "decision",
            name: "Budget Approval Policy",
            summary: "Policy for approving budgets",
            tags: ["finance"],
            complexity: "moderate",
            status: "draft",
          },
        ],
      };
      for (const status of ["draft", "accepted", "deprecated"]) {
        const graph = structuredClone(decisionGraph);
        const decisionNode = graph.nodes.find((n) => n.id === "decision:budget-approval") as any;
        decisionNode.status = status;
        const result = validateGraph(graph);
        expect(result.success).toBe(true);
        expect(result.data!.nodes.find((n) => n.id === "decision:budget-approval")!.status).toBe(status);
      }
    });

    it("implemented_by edge type is accepted (cross-graph bridge)", () => {
      const graph = structuredClone(knowledgeGraph);
      // Add a file node so implemented_by edge target exists
      graph.nodes.push({
        id: "file:src/invoicing/assign.ts",
        type: "file",
        name: "assign.ts",
        filePath: "src/invoicing/assign.ts",
        summary: "Invoice assignment logic",
        tags: ["invoicing"],
        complexity: "moderate",
      });
      graph.edges.push({
        source: "feature:invoice-assignment",
        target: "file:src/invoicing/assign.ts",
        type: "implemented_by",
        direction: "forward",
        weight: 0.8,
      });
      // implemented_by is a valid bridge edge type
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      const edge = result.data!.edges.find((e) => e.type === "implemented_by");
      expect(edge).toBeDefined();
    });
  });

  describe("rejects deprecated types", () => {
    it("flow node type is rejected", () => {
      const graph = structuredClone(knowledgeGraph);
      (graph.nodes[1] as any).type = "flow";
      const result = validateGraph(graph);
      // Graph still succeeds with remaining valid nodes
      expect(result.success).toBe(true);
      // But the flow node should be dropped (not in result)
      expect(result.data!.nodes.find((n) => n.id === "feature:invoice-assignment")).toBeUndefined();
      expect(result.issues).toContainEqual(
        expect.objectContaining({ level: "dropped", category: "invalid-node" })
      );
    });

    it("step node type is rejected", () => {
      const graph = structuredClone(knowledgeGraph);
      (graph.nodes[1] as any).type = "step";
      const result = validateGraph(graph);
      // Graph still succeeds with remaining valid nodes
      expect(result.success).toBe(true);
      // But the step node should be dropped (not in result)
      expect(result.data!.nodes.find((n) => n.id === "feature:invoice-assignment")).toBeUndefined();
      expect(result.issues).toContainEqual(
        expect.objectContaining({ level: "dropped", category: "invalid-node" })
      );
    });

    it("contains_flow edge type is rejected", () => {
      const graph = structuredClone(knowledgeGraph);
      (graph.edges[0] as any).type = "contains_flow";
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges.find((e) => (e as any).type === "contains_flow")).toBeUndefined();
      expect(result.issues).toContainEqual(
        expect.objectContaining({ level: "dropped", category: "invalid-edge" })
      );
    });

    it("flow_step edge type is rejected", () => {
      const graph = structuredClone(knowledgeGraph);
      (graph.edges[0] as any).type = "flow_step";
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges.find((e) => (e as any).type === "flow_step")).toBeUndefined();
      expect(result.issues).toContainEqual(
        expect.objectContaining({ level: "dropped", category: "invalid-edge" })
      );
    });

    it("cross_domain edge type is rejected", () => {
      const graph = structuredClone(knowledgeGraph);
      (graph.edges[0] as any).type = "cross_domain";
      const result = validateGraph(graph);
      expect(result.success).toBe(true);
      expect(result.data!.edges.find((e) => (e as any).type === "cross_domain")).toBeUndefined();
      expect(result.issues).toContainEqual(
        expect.objectContaining({ level: "dropped", category: "invalid-edge" })
      );
    });
  });
});