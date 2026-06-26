import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KnowledgeGraph, GraphNode, GraphEdge, AnalysisMeta, ProjectConfig, ProjectSingletonMeta } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";
import { toNeo4jLabel } from "../schema.js";

const PROJECT_SINGLETON_ID = "project:singleton";

const UA_DIR = ".grasp-it";
const FINGERPRINT_FILE = "fingerprints.json";
const CONFIG_FILE = "config.json";

// Allowed Neo4j node labels for codebase/graph nodes
const ALLOWED_LABELS = [
  "File", "Function", "Class", "Interface", "Enum", "Module",
  "Layer", "Tour", "Domain", "Feature", "Operation", "Actor",
  "BusinessRule", "Entity", "Project",
];

// Codebase node types that must have kind = "codebase"
const CODEBASE_TYPES = new Set([
  "file", "function", "class", "module", "interface", "enum",
  "concept", "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
]);

// Domain/knowledge node types that must have kind = "knowledge"
const KNOWLEDGE_TYPES = new Set([
  "domain", "feature", "operation", "actor", "business-rule", "entity",
  "article", "topic", "claim", "source", "decision", "constraint", "risk",
]);

/**
 * Validate that a node's Neo4j label is in the allowed list.
 * Throws if the label is not allowed.
 */
function validateNodeLabel(node: GraphNode): void {
  const label = toNeo4jLabel(node.type);
  if (!ALLOWED_LABELS.includes(label)) {
    throw new Error(
      `Invalid node label "${label}" for node "${node.id}" (type: "${node.type}"). ` +
      `Allowed labels: ${ALLOWED_LABELS.join(", ")}`,
    );
  }
}

/**
 * Validate that a node's kind property is consistent with its type.
 * Throws if kind is present but inconsistent with the node type.
 */
function validateNodeKind(node: GraphNode): void {
  const { kind, type } = node;
  if (kind === undefined || kind === null) return;

  if (CODEBASE_TYPES.has(type) && kind !== "codebase") {
    throw new Error(
      `Node "${node.id}" (type: "${type}") must have kind = "codebase" but got kind = "${kind}".`,
    );
  }
  if (KNOWLEDGE_TYPES.has(type) && kind !== "knowledge") {
    throw new Error(
      `Node "${node.id}" (type: "${type}") must have kind = "knowledge" but got kind = "${kind}".`,
    );
  }
}

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, UA_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const DEFAULT_CONFIG: ProjectConfig = { autoUpdate: false, outputLanguage: "en" };

export function saveFingerprints(projectRoot: string, store: FingerprintStore): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, FINGERPRINT_FILE), JSON.stringify(store, null, 2), "utf-8");
}

export function loadFingerprints(projectRoot: string): FingerprintStore | null {
  const filePath = join(projectRoot, UA_DIR, FINGERPRINT_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as FingerprintStore;
  } catch {
    return null;
  }
}

/**
 * Save the project config to `.grasp-it/config.json`, preserving any existing
 * fields not present in the new config (e.g., `version` set by `/grasp`).
 */
export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  const dir = ensureDir(projectRoot);
  const filePath = join(dir, CONFIG_FILE);
  const existing: ProjectConfig = existsSync(filePath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectConfig;
        } catch {
          return { ...DEFAULT_CONFIG };
        }
      })()
    : { ...DEFAULT_CONFIG };
  const merged: ProjectConfig = { ...existing, ...config };
  writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf-8");
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const filePath = join(projectRoot, UA_DIR, CONFIG_FILE);
  if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ProjectConfig;
    // Defensive: ensure autoUpdate is always a boolean (defaults if missing).
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── Neo4j Graph Persistence ───────────────────────────────────────────────────

/**
 * Node property map for Neo4j persistence.
 * Keys match the property names stored in Neo4j.
 * Infers `kind` from node type if not explicitly set.
 */
function nodeToProperties(node: GraphNode): Record<string, unknown> {
  // Infer kind from node type if not explicitly set
  const kind = node.kind ?? (CODEBASE_TYPES.has(node.type) ? "codebase" : KNOWLEDGE_TYPES.has(node.type) ? "knowledge" : null);

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    summary: node.summary ?? "",
    filePath: node.filePath ?? null,
    lineRange: node.lineRange ?? null,
    tags: node.tags ?? [],
    complexity: node.complexity ?? "simple",
    languageNotes: node.languageNotes ?? null,
    domainMeta: node.domainMeta ? JSON.stringify(node.domainMeta) : null,
    knowledgeMeta: node.knowledgeMeta ? JSON.stringify(node.knowledgeMeta) : null,
    rationale: node.rationale ?? null,
    status: node.status ?? null,
    scope: node.scope ? JSON.stringify(node.scope) : null,
    condition: node.condition ?? null,
    invariant: node.invariant ?? null,
    confidence: node.confidence ?? null,
    subConcepts: node.subConcepts ? JSON.stringify(node.subConcepts) : null,
    constrainedBy: node.constrainedBy ? JSON.stringify(node.constrainedBy) : null,
    permissions: node.permissions ? JSON.stringify(node.permissions) : null,
    restrictions: node.restrictions ? JSON.stringify(node.restrictions) : null,
    ruleText: node.ruleText ?? null,
    analyzedAtCommit: node.analyzedAtCommit ?? null,
    kind,
    source: node.source ?? null,
    severity: node.severity ?? null,
    probability: node.probability ?? null,
    mitigation: node.mitigation ?? null,
    generatedAt: node.generatedAt ?? null,
    sourceCommit: node.sourceCommit ?? null,
    ...(kind === "knowledge" ? { sourceFiles: node.sourceFiles ?? null } : {}),
  };
}

/**
 * Edge property map for Neo4j persistence.
 */
function edgeToProperties(edge: GraphEdge): Record<string, unknown> {
  return {
    id: `${edge.source}:${edge.target}:${edge.type}`,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    direction: edge.direction,
    description: edge.description ?? null,
    weight: edge.weight,
  };
}

/**
 * Persist a full knowledge graph to Neo4j.
 *
 * Clears all existing nodes and edges for the project, then writes all nodes,
 * edges, layers, and tour steps. Project metadata is stored in the Project
 * singleton node.
 *
 * @param session   Neo4j driver session
 * @param graph     Knowledge graph to persist
 * @param projectId Project identifier (defaults to "project:singleton")
 */
export async function saveGraphToNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  graph: KnowledgeGraph,
  projectId: string = PROJECT_SINGLETON_ID,
): Promise<void> {
  // Clear existing graph data for this project
  await session.run(
    `MATCH (n)-[r]-() WHERE n.projectId = $projectId OR n.id = $projectId DELETE r`,
    { projectId },
  );
  await session.run(
    `MATCH (n) WHERE n.projectId = $projectId DELETE n`,
    { projectId },
  );

  // Merge the Project singleton — only structural + per-graph properties.
  // The four migrated fields (gitCommitHash, lastAnalyzedAt, version,
  // analyzedFiles) are NOT written here; they live elsewhere
  // (File-node aggregation and .grasp-it/config.json).
  await session.run(
    `MERGE (p:Project {id: $projectId})
 SET p.name = $name,
         p.languages   = $languages,
         p.frameworks  = $frameworks,
         p.description = $description,
         p.kind        = "project"`,
    {
      projectId,
      name: graph.project.name,
      languages: graph.project.languages,
      frameworks: graph.project.frameworks,
      description: graph.project.description,
    },
  );

  // Write nodes with projectId label
  for (const node of graph.nodes) {
    validateNodeLabel(node);
    validateNodeKind(node);
    const props = nodeToProperties(node);
    const label = toNeo4jLabel(node.type);
    // Use Codebase: grouping label for codebase nodes, Knowledge: for knowledge nodes
    const groupLabel = CODEBASE_TYPES.has(node.type) ? "Codebase" : "Knowledge";
    await session.run(
      `MATCH (p:Project {id: $projectId})
       CREATE (n:${groupLabel}:${label} {
         projectId: $projectId,
         ${Object.keys(props).map((k) => `${k}: $${k}`).join(", ")}
       })
       CREATE (n)-[:PART_OF]->(p)`,
      { projectId, ...props },
    );
  }

  // Write edges
  for (const edge of graph.edges) {
    const props = edgeToProperties(edge);
    // Use any-node match since nodes have specific labels (File, Function, etc.), not GraphNode
    await session.run(
      `MATCH (src {id: $edgeSource, projectId: $projectId})
       MATCH (tgt {id: $edgeTarget, projectId: $projectId})
       CREATE (src)-[r:RELATES {id: $id, type: $type, direction: $direction, description: $description, weight: $weight}]->(tgt)`,
      { projectId, edgeSource: props.source, edgeTarget: props.target, id: props.id, type: props.type, direction: props.direction, description: props.description, weight: props.weight },
    );
  }

  // Write layers
  for (const layer of graph.layers) {
    await session.run(
      `MATCH (p:Project {id: $projectId})
       CREATE (l:Layer {
         projectId: $projectId,
         id: $id,
         name: $name,
         description: $description,
         nodeIds: $nodeIds
       })
       CREATE (l)-[:PART_OF]->(p)`,
      {
        projectId,
        id: layer.id,
        name: layer.name,
        description: layer.description,
        nodeIds: layer.nodeIds,
      },
    );
  }

  // Write tour steps
  for (const step of graph.tour) {
    await session.run(
      `MATCH (p:Project {id: $projectId})
       CREATE (t:TourStep {
         projectId: $projectId,
         order: $order,
         title: $title,
         description: $description,
         nodeIds: $nodeIds,
         languageLesson: $languageLesson
       })
       CREATE (t)-[:PART_OF]->(p)`,
      {
        projectId,
        order: step.order,
        title: step.title,
        description: step.description,
        nodeIds: step.nodeIds,
        languageLesson: step.languageLesson ?? null,
      },
    );
  }
}

/**
 * Load a full knowledge graph from Neo4j.
 *
 * Queries all nodes, edges, layers, and tour steps for the given project.
 * Returns null if no Project singleton exists (first run).
 *
 * @param session   Neo4j driver session
 * @param projectId Project identifier (defaults to "project:singleton")
 */
export async function loadGraphFromNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  projectId: string = PROJECT_SINGLETON_ID,
  projectRoot?: string,
): Promise<KnowledgeGraph | null> {
  // Load project singleton — only structural + per-graph properties.
  // The four migrated fields are derived elsewhere (File-node aggregation,
  // .grasp-it/config.json).
  const projectResult = await session.run(
    `MATCH (p:Project {id: $projectId})
     RETURN p.name AS name, p.languages AS languages, p.frameworks AS frameworks,
            p.description AS description`,
    { projectId },
  );

  const projectRecord = projectResult.records[0] as unknown as Record<string, unknown> | undefined;
  if (!projectRecord) return null;

  // Load nodes
  const nodesResult = await session.run(
    `MATCH (n:Codebase)-[:PART_OF]->(p:Project {id: $projectId})
     RETURN n`,
    { projectId },
  );

  const nodes: GraphNode[] = [];
  for (const record of nodesResult.records) {
    const n = (record as unknown as Record<string, unknown>)["n"] as Record<string, unknown>;
    nodes.push({
      id: n["id"] as string,
      name: n["name"] as string,
      type: n["type"] as GraphNode["type"],
      summary: (n["summary"] as string) ?? "",
      filePath: n["filePath"] as string | undefined,
      lineRange: n["lineRange"] as [number, number] | undefined,
      tags: (n["tags"] as string[]) ?? [],
      complexity: (n["complexity"] as GraphNode["complexity"]) ?? "simple",
      languageNotes: n["languageNotes"] as string | undefined,
      domainMeta: n["domainMeta"] ? JSON.parse(n["domainMeta"] as string) : undefined,
      knowledgeMeta: n["knowledgeMeta"] ? JSON.parse(n["knowledgeMeta"] as string) : undefined,
      rationale: n["rationale"] as string | undefined,
      status: n["status"] as GraphNode["status"],
      scope: n["scope"] ? JSON.parse(n["scope"] as string) : undefined,
      condition: n["condition"] as string | undefined,
      invariant: n["invariant"] as string | undefined,
      confidence: n["confidence"] as GraphNode["confidence"],
      subConcepts: n["subConcepts"] ? JSON.parse(n["subConcepts"] as string) : undefined,
      constrainedBy: n["constrainedBy"] ? JSON.parse(n["constrainedBy"] as string) : undefined,
      permissions: n["permissions"] ? JSON.parse(n["permissions"] as string) : undefined,
      restrictions: n["restrictions"] ? JSON.parse(n["restrictions"] as string) : undefined,
      ruleText: n["ruleText"] as string | undefined,
      analyzedAtCommit: n["analyzedAtCommit"] as string | undefined,
      kind: n["kind"] as GraphNode["kind"],
      source: n["source"] as GraphNode["source"],
      severity: n["severity"] as GraphNode["severity"],
      probability: n["probability"] as GraphNode["probability"],
      mitigation: n["mitigation"] as string | undefined,
      generatedAt: n["generatedAt"] as string | undefined,
      sourceCommit: n["sourceCommit"] as string | undefined,
      ...(n["kind"] === "knowledge" ? { sourceFiles: n["sourceFiles"] ? JSON.parse(n["sourceFiles"] as string) : undefined } : {}),
    });
  }

  // Load edges
  const edgesResult = await session.run(
    `MATCH (source:Codebase)-[r:RELATES]->(target:Codebase)
     WHERE source.projectId = $projectId AND target.projectId = $projectId
     RETURN r`,
    { projectId },
  );

  const edges: GraphEdge[] = [];
  for (const record of edgesResult.records) {
    const r = (record as unknown as Record<string, unknown>)["r"] as Record<string, unknown>;
    edges.push({
      source: r["source"] as string,
      target: r["target"] as string,
      type: r["type"] as GraphEdge["type"],
      direction: r["direction"] as GraphEdge["direction"],
      description: r["description"] as string | undefined,
      weight: (r["weight"] as number) ?? 1,
    });
  }

  // Load layers
  const layersResult = await session.run(
    `MATCH (l:Layer)-[:PART_OF]->(p:Project {id: $projectId})
     RETURN l`,
    { projectId },
  );

  const layers = layersResult.records.map((record) => {
    const l = (record as unknown as Record<string, unknown>)["l"] as Record<string, unknown>;
    return {
      id: l["id"] as string,
      name: l["name"] as string,
      description: l["description"] as string,
      nodeIds: (l["nodeIds"] as string[]) ?? [],
    };
  });

  // Load tour steps
  const tourResult = await session.run(
    `MATCH (t:TourStep)-[:PART_OF]->(p:Project {id: $projectId})
     RETURN t ORDER BY t.order`,
    { projectId },
  );

  const tour = tourResult.records.map((record) => {
    const t = (record as unknown as Record<string, unknown>)["t"] as Record<string, unknown>;
    return {
      order: t["order"] as number,
      title: t["title"] as string,
      description: t["description"] as string,
      nodeIds: (t["nodeIds"] as string[]) ?? [],
      languageLesson: t["languageLesson"] as string | undefined,
    };
  });

  // The four migrated fields are derived elsewhere — for `version`, fall back
  // to .grasp-it/config.json when `projectRoot` is provided.
  const version = projectRoot ? loadConfig(projectRoot).version ?? "1.0.0" : "1.0.0";

  return {
    version,
    kind: "codebase",
    project: {
      name: projectRecord["name"] as string,
      languages: (projectRecord["languages"] as string[]) ?? [],
      frameworks: (projectRecord["frameworks"] as string[]) ?? [],
      description: (projectRecord["description"] as string) ?? "",
      analyzedAt: "",
      gitCommitHash: "",
    },
    nodes,
    edges,
    layers,
    tour,
  };
}

// ── Neo4j Project Singleton ──────────────────────────────────────────────────

/**
 * DEPRECATED: project-level metadata fields have been migrated off the
 * Project singleton. New callers should derive `gitCommitHash`,
 * `lastAnalyzedAt`, `analyzedFiles` from File-node aggregations and
 * `version` from `.grasp-it/config.json`.
 *
 * This function is kept as a no-op for backwards compatibility with existing
 * callers that import it — the legacy fields are no longer written.
 *
 * @param session   Neo4j driver session
 * @param _meta     (ignored — fields no longer persisted here)
 * @param _projectId (ignored — singleton anchor)
 */
export async function saveProjectMetaToNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  _session?: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  _meta?: AnalysisMeta,
  _projectId: string = PROJECT_SINGLETON_ID,
): Promise<void> {
  // No-op: the four migrated fields are no longer stored on the Project singleton.
}

/**
 * DEPRECATED: project-level metadata fields have been migrated off the
 * Project singleton. Returns `null` (the Project singleton now exists
 * structurally as the `:PART_OF` anchor but carries no semantic content).
 *
 * @deprecated Use File-node aggregation (`max(File.analyzedAtCommit)` etc.)
 * and `.grasp-it/config.json` for `version`.
 */
export async function loadProjectMetaFromNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  _session?: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  _projectId: string = PROJECT_SINGLETON_ID,
): Promise<ProjectSingletonMeta | null> {
  return null;
}

// ── Domain Graph Neo4j Persistence ──────────────────────────────────────────

/**
 * Load domain graph from Neo4j.
 * Returns nodes with label Knowledge plus their secondary label (Domain/Feature/etc).
 *
 * @param session Neo4j driver session
 * @param projectId Project identifier (defaults to "project:singleton")
 */
export async function loadDomainGraphFromNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  projectId: string = PROJECT_SINGLETON_ID,
): Promise<KnowledgeGraph | null> {
  const result = await session.run(
    `MATCH (d:Knowledge)-[:PART_OF]->(p:Project {id: $projectId})
     RETURN d.id AS id, d.name AS name, d.summary AS summary, d.type AS type,
            d.source AS source, d.sourceFile AS sourceFile, d.filePath AS filePath,
            d.lineRange AS lineRange, d.tags AS tags, d.complexity AS complexity,
            d.sourceFiles AS sourceFiles, d.generatedAt AS generatedAt,
            d.sourceCommit AS sourceCommit, labels(d) AS labels`,
    { projectId },
  );

  if (result.records.length === 0) {
    return null;
  }

  const nodes: GraphNode[] = [];
  for (const record of result.records) {
    const rec = record as unknown as Record<string, unknown>;

    nodes.push({
      id: rec["id"] as string,
      name: rec["name"] as string,
      summary: (rec["summary"] as string) ?? "",
      type: (rec["type"] as GraphNode["type"]) ?? "domain",
      source: rec["source"] as GraphNode["source"],
      filePath: rec["filePath"] as string | undefined,
      lineRange: rec["lineRange"] as [number, number] | undefined,
      tags: (rec["tags"] as string[]) ?? [],
      complexity: (rec["complexity"] as GraphNode["complexity"]) ?? "simple",
      sourceFiles: (rec["sourceFiles"] as string[] | undefined) ?? undefined,
      generatedAt: rec["generatedAt"] as string | undefined,
      sourceCommit: rec["sourceCommit"] as string | undefined,
    });
  }

  return {
    version: "1.0.0",
    kind: "codebase",
    project: {
      name: "",
      languages: [],
      frameworks: [],
      description: "",
      analyzedAt: "",
      gitCommitHash: "",
    },
    nodes,
    edges: [],
    layers: [],
    tour: [],
  };
}

/**
 * Save domain graph to Neo4j.
 * Writes Knowledge nodes with secondary labels (Domain/Feature/etc).
 *
 * Domain nodes carry `analyzedAtCommit` and `analyzedAt` properties for
 * per-Domain staleness tracking — this replaces the legacy
 * `Project.domainCommit` / `Project.domainAnalyzedAt` global stamp that was
 * removed in Task F. The Project singleton is no longer updated with
 * domain-analysis metadata; it remains purely a structural anchor for
 * `:PART_OF` edges.
 *
 * @param session   Neo4j driver session
 * @param graph     Domain graph to persist
 * @param projectId Project identifier (defaults to "project:singleton")
 * @param commit    Git commit hash at which domain analysis was run
 */
export async function saveDomainGraphToNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  graph: KnowledgeGraph,
  projectId: string = PROJECT_SINGLETON_ID,
  commit?: string,
): Promise<void> {
  // Resolve the commit to stamp on Domain nodes. Falls back to the graph's
  // project.gitCommitHash field (set by /grasp-domain Phase 5 in the JSON).
  const currentCommit = commit ?? graph.project?.gitCommitHash ?? "";
  const now = new Date().toISOString();

  // Clear existing domain elements for this project
  await session.run(
    `MATCH (d:Knowledge)-[:PART_OF]->(p:Project {id: $projectId})
     DELETE d`,
    { projectId },
  );

  // Write new domain elements
  for (const node of graph.nodes) {
    validateNodeLabel(node);
    validateNodeKind(node);
    const secondaryLabel = toNeo4jLabel(node.type);
    const labels = `Knowledge:${secondaryLabel}`;

    // Domain nodes carry per-Domain staleness properties (analyzedAtCommit,
    // analyzedAt). Other Knowledge node types stay without these — only
    // Domain is the staleness tracking unit (top of the domain hierarchy).
    const isDomain = node.type === "domain";
    const domainProps = isDomain
      ? `analyzedAtCommit: $analyzedAtCommit, analyzedAt: $analyzedAt,`
      : "";

    const params: Record<string, unknown> = {
      projectId,
      id: node.id,
      name: node.name,
      type: node.type,
      summary: node.summary ?? "",
      source: node.source ?? "code-analysis",
      filePath: node.filePath ?? null,
      lineRange: node.lineRange ?? null,
      tags: node.tags ?? [],
      complexity: node.complexity ?? "simple",
      sourceFiles: node.sourceFiles ?? null,
      generatedAt: node.generatedAt ?? null,
      sourceCommit: node.sourceCommit ?? null,
    };
    if (isDomain) {
      params.analyzedAtCommit = currentCommit;
      params.analyzedAt = now;
    }

    await session.run(
      `MATCH (p:Project {id: $projectId})
       CREATE (d:${labels} {
         id: $id,
         name: $name,
         type: $type,
         summary: $summary,
         source: $source,
         filePath: $filePath,
         lineRange: $lineRange,
         tags: $tags,
         complexity: $complexity,
         kind: "knowledge",
         sourceFiles: $sourceFiles,
         generatedAt: $generatedAt,
         sourceCommit: $sourceCommit,
         ${domainProps}
         projectId: $projectId
       })
       CREATE (d)-[:PART_OF]->(p)`,
      params,
    );
  }
}

// Note: The following functions were removed in the Neo4j-first migration.
// All reads/writes now go directly to Neo4j only.
// - loadGraph / saveGraph: removed (use loadGraphFromNeo4j / saveGraphToNeo4j)
// - loadMeta / saveMeta: removed (use loadProjectMetaFromNeo4j / saveProjectMetaToNeo4j)
// - loadDomainGraph / saveDomainGraph: removed (use loadDomainGraphFromNeo4j / saveDomainGraphToNeo4j)
