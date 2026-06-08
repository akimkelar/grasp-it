import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, isAbsolute, relative, basename } from "node:path";
import type { KnowledgeGraph, GraphNode, GraphEdge, AnalysisMeta, ProjectConfig, ProjectSingletonMeta } from "../types.js";
import type { FingerprintStore } from "../fingerprint.js";
import { validateGraph } from "../schema.js";

const PROJECT_SINGLETON_ID = "project:singleton";

const UA_DIR = ".grasp-it";
const GRAPH_FILE = "knowledge-graph.json";
const META_FILE = "meta.json";
const FINGERPRINT_FILE = "fingerprints.json";
const CONFIG_FILE = "config.json";

function ensureDir(projectRoot: string): string {
  const dir = join(projectRoot, UA_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitise every node's filePath before writing to disk.
 *
 * The analysis agent produces absolute paths like:
 *   /Users/alice/company/src/auth.ts
 *
 * We convert them to paths relative to projectRoot:
 *   src/auth.ts
 *
 * Three cases are handled:
 *   1. Path is inside projectRoot      → make it relative
 *   2. Path is absolute but outside    → keep only the filename (last segment)
 *   3. Path is already relative        → leave it untouched
 *
 * This means the developer's home directory, username, and company
 * directory layout are never written to knowledge-graph.json.
 */
function sanitiseFilePaths(
  graph: KnowledgeGraph,
  projectRoot: string,
): KnowledgeGraph {
  const normalRoot = projectRoot.endsWith("/")
    ? projectRoot
    : projectRoot + "/";

  const sanitisedNodes = graph.nodes.map((node) => {
    if (typeof node.filePath !== "string") return node;

    const fp = node.filePath;

    if (!isAbsolute(fp)) {
      // Already relative — nothing to do.
      return node;
    }

    if (fp.startsWith(normalRoot) || fp.startsWith(projectRoot)) {
      // Inside the project root — make it relative.
      return { ...node, filePath: relative(projectRoot, fp) };
    }

    // Absolute but outside the project root — use only the filename
    // so we leak as little as possible.
    return { ...node, filePath: basename(fp) };
  });

  return { ...graph, nodes: sanitisedNodes };
}

export function saveGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);

  // FIX — sanitise absolute file paths before persisting.
  // Without this, absolute paths like /Users/alice/company/src/auth.ts
  // are written verbatim into knowledge-graph.json and later served
  // by the dashboard server, leaking the developer's directory layout.
  const sanitised = sanitiseFilePaths(graph, projectRoot);

  writeFileSync(
    join(dir, GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(projectRoot, UA_DIR, GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid knowledge graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}

export function saveMeta(projectRoot: string, meta: AnalysisMeta): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), "utf-8");
}

export function loadMeta(projectRoot: string): AnalysisMeta | null {
  const filePath = join(projectRoot, UA_DIR, META_FILE);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as AnalysisMeta;
}

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

const DEFAULT_CONFIG: ProjectConfig = { autoUpdate: false, outputLanguage: "en" };

export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  const dir = ensureDir(projectRoot);
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), "utf-8");
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const filePath = join(projectRoot, UA_DIR, CONFIG_FILE);
  if (!existsSync(filePath)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as ProjectConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

const DOMAIN_GRAPH_FILE = "domain-graph.json";

export function saveDomainGraph(projectRoot: string, graph: KnowledgeGraph): void {
  const dir = ensureDir(projectRoot);
  const sanitised = sanitiseFilePaths(graph, projectRoot);
  writeFileSync(
    join(dir, DOMAIN_GRAPH_FILE),
    JSON.stringify(sanitised, null, 2),
    "utf-8",
  );
}

export function loadDomainGraph(
  projectRoot: string,
  options?: { validate?: boolean },
): KnowledgeGraph | null {
  const filePath = join(projectRoot, UA_DIR, DOMAIN_GRAPH_FILE);
  if (!existsSync(filePath)) return null;

  const data = JSON.parse(readFileSync(filePath, "utf-8"));

  if (options?.validate !== false) {
    const result = validateGraph(data);
    if (!result.success) {
      throw new Error(
        `Invalid domain graph: ${result.fatal ?? "unknown error"}`,
      );
    }
    return result.data as KnowledgeGraph;
  }

  return data as KnowledgeGraph;
}

// ── Neo4j Project Singleton ──────────────────────────────────────────────────

/**
 * Persist project-level metadata to the shared Project singleton node in Neo4j.
 * This node is the authoritative source of the last-analyzed commit hash in
 * multi-user setups, replacing the local-only `.grasp-it/meta.json`.
 *
 * Requires a Neo4j driver session (from neo4j-driver).
 *
 * @example
 * import { driver } from "neo4j-driver";
 * const session = driver.session();
 * await saveProjectMeta(session, meta);
 * await session.close();
 */
export async function saveProjectMeta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  meta: AnalysisMeta,
): Promise<void> {
  await session.run(
    `MERGE (p:Project {id: $id})
     SET p.gitCommitHash  = $gitCommitHash,
         p.lastAnalyzedAt = $lastAnalyzedAt,
         p.version        = $version,
         p.analyzedFiles  = $analyzedFiles,
         p.kind           = "project"`,
    {
      id: PROJECT_SINGLETON_ID,
      gitCommitHash: meta.gitCommitHash,
      lastAnalyzedAt: meta.lastAnalyzedAt,
      version: meta.version,
      analyzedFiles: meta.analyzedFiles,
    },
  );
}

/**
 * Load project-level metadata from the Project singleton node in Neo4j.
 * Returns null if the node does not exist yet (first run).
 *
 * Requires a Neo4j driver session (from neo4j-driver).
 *
 * @example
 * import { driver } from "neo4j-driver";
 * const session = driver.session();
 * const meta = await loadProjectMeta(session);
 * await session.close();
 */
export async function loadProjectMeta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
): Promise<ProjectSingletonMeta | null> {
  const result = await session.run(
    `MATCH (p:Project {id: $id}) RETURN p.gitCommitHash AS gitCommitHash, p.lastAnalyzedAt AS lastAnalyzedAt, p.version AS version, p.analyzedFiles AS analyzedFiles`,
    { id: PROJECT_SINGLETON_ID },
  );

  const record = result.records[0] as unknown as Record<string, unknown> | undefined;
  if (!record) return null;

  return {
    gitCommitHash: record["gitCommitHash"] as string,
    lastAnalyzedAt: record["lastAnalyzedAt"] as string,
    version: record["version"] as string,
    analyzedFiles: record["analyzedFiles"] as number,
  };
}

// ── Domain Graph Neo4j Persistence ──────────────────────────────────────────

// Domain element secondary labels map
const DOMAIN_ELEMENT_LABELS: Record<string, string> = {
  domain: "Domain",
  feature: "Feature",
  operation: "Operation",
  actor: "Actor",
  "business-rule": "BusinessRule",
  entity: "Entity",
};

/**
 * Load domain graph from Neo4j.
 * Returns nodes with label DomainElement plus their secondary label (Domain/Feature/etc).
 * Falls back to JSON file if Neo4j is unavailable or has no domain elements.
 *
 * @param session - Neo4j driver session
 * @param projectId - Project identifier (defaults to "project:singleton")
 */
export async function loadDomainGraphFromNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  projectId: string = PROJECT_SINGLETON_ID,
): Promise<KnowledgeGraph | null> {
  const result = await session.run(
    `MATCH (d:DomainElement)-[:PART_OF]->(p:Project {id: $projectId})
     RETURN d.id AS id, d.name AS name, d.summary AS summary, d.type AS nodeType,
            d.source AS source, d.sourceFile AS sourceFile, d.filePath AS filePath,
            d.lineRange AS lineRange, d.tags AS tags, d.complexity AS complexity,
            labels(d) AS labels`,
    { projectId },
  );

  if (result.records.length === 0) {
    return null;
  }

  const nodes: GraphNode[] = [];
  for (const record of result.records) {
    const rec = record as unknown as Record<string, unknown>;
    const labels = rec["labels"] as string[];
    // Get the secondary label (first label that isn't DomainElement)
    const secondaryLabel = labels?.find((l) => l !== "DomainElement") ?? "domain";
    const nodeType = Object.entries(DOMAIN_ELEMENT_LABELS).find(
      ([, v]) => v === secondaryLabel,
    )?.[0] ?? "domain";

    nodes.push({
      id: rec["id"] as string,
      name: rec["name"] as string,
      summary: (rec["summary"] as string) ?? "",
      type: nodeType as GraphNode["type"],
      source: rec["source"] as GraphNode["source"],
      filePath: rec["filePath"] as string | undefined,
      lineRange: rec["lineRange"] as [number, number] | undefined,
      tags: (rec["tags"] as string[]) ?? [],
      complexity: (rec["complexity"] as GraphNode["complexity"]) ?? "simple",
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
 * Writes DomainElement nodes with secondary labels (Domain/Feature/etc).
 * Updates Project node with domainAnalyzedAt and domainCommit.
 *
 * @param session - Neo4j driver session
 * @param graph - Domain graph to persist
 * @param projectId - Project identifier (defaults to "project:singleton")
 * @param commit - Git commit hash at which domain analysis was run
 */
export async function saveDomainGraphToNeo4j(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: { run: (query: string, params: Record<string, any>) => Promise<{ records: unknown[] }> },
  graph: KnowledgeGraph,
  projectId: string = PROJECT_SINGLETON_ID,
  commit?: string,
): Promise<void> {
  // Clear existing domain elements for this project
  await session.run(
    `MATCH (d:DomainElement)-[:PART_OF]->(p:Project {id: $projectId})
     DELETE d`,
    { projectId },
  );

  // Write new domain elements
  for (const node of graph.nodes) {
    const secondaryLabel = DOMAIN_ELEMENT_LABELS[node.type] ?? "Domain";
    const labels = `DomainElement:${secondaryLabel}`;

    await session.run(
      `MATCH (p:Project {id: $projectId})
       CREATE (d:${labels} {
         id: $id,
         name: $name,
         summary: $summary,
         source: $source,
         filePath: $filePath,
         lineRange: $lineRange,
         tags: $tags,
         complexity: $complexity
       })
       CREATE (d)-[:PART_OF]->(p)`,
      {
        projectId,
        id: node.id,
        name: node.name,
        summary: node.summary ?? "",
        source: node.source ?? "code-analysis",
        filePath: node.filePath ?? null,
        lineRange: node.lineRange ?? null,
        tags: node.tags ?? [],
        complexity: node.complexity ?? "simple",
      },
    );
  }

  // Update Project with domain analysis metadata
  const now = new Date().toISOString();
  const domainCommit = commit ?? graph.project?.gitCommitHash ?? "";

  await session.run(
    `MATCH (p:Project {id: $projectId})
     SET p.domainAnalyzedAt = $domainAnalyzedAt,
         p.domainCommit = $domainCommit`,
    { projectId, domainAnalyzedAt: now, domainCommit },
  );
}
