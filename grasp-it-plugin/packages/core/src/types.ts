// Node types (27 total: 5 code + 8 non-code + 6 domain + 5 knowledge + 2 extended + 1 legacy)
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "domain" | "feature" | "operation" | "actor" | "business-rule" | "entity"
  | "article" | "topic" | "claim" | "source"
  | "decision" | "constraint"
  | "risk";

// Edge types (47 total in 11 categories: Structural, Behavioral, Data flow, Dependencies, Semantic, Infrastructure, Schema, Domain, Business, Bridge, Knowledge, Conversation)
export type EdgeType =
  | "imports" | "exports" | "contains" | "inherits" | "implements"  // Structural
  | "calls" | "subscribes" | "publishes" | "middleware"              // Behavioral
  | "reads_from" | "writes_to" | "transforms" | "validates"         // Data flow
  | "depends_on" | "tested_by" | "configures"                       // Dependencies
  | "related" | "similar_to"                                         // Semantic
  | "deploys" | "serves" | "provisions" | "triggers"               // Infrastructure
  | "migrates" | "documents" | "routes" | "defines_schema"         // Schema/Data
  | "has_feature" | "has_operation" | "sequence"                    // Domain
  | "performed_by" | "restricted_for" | "governs" | "uses_entity"  // Business
  | "implemented_by"                                                // Bridge
  | "cites" | "contradicts" | "builds_on" | "exemplifies" | "categorized_under" | "authored_by" // Knowledge
  | "decides" | "constrained_by" | "supports" | "applies_in" | "sub_concept_of"
  | "has_risk" | "mitigated_by"; // Conversation

// Optional knowledge metadata for article/entity/topic/claim/source nodes
export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
}

// Optional domain metadata for domain nodes
export interface DomainMeta {
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoint?: string;
  entryType?: "http" | "cli" | "event" | "cron" | "manual";
}

// GraphNode with extended types (decision, constraint) and optional conversation properties
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  languageNotes?: string;
  domainMeta?: DomainMeta;
  knowledgeMeta?: KnowledgeMeta;
  // Extended properties
  rationale?: string;                              // Decision, Claim
  status?: "proposed" | "accepted" | "implemented" | "planned" | "partial" | "deprecated" | "draft" | "active"; // Decision, Feature, Operation, BusinessRule
  scope?: string[];                                 // Decision, Constraint
  condition?: string;                             // Constraint
  invariant?: string;                             // Constraint
  confidence?: "tentative" | "agreed";            // Claim
  subConcepts?: string[];                         // Concept (composition)
  constrainedBy?: string[];                       // Concept (constraint refs)
  // Business node properties
  permissions?: string[];                          // Actor
  restrictions?: string[];                        // Actor
  ruleText?: string;                              // BusinessRule
  // Codebase node properties
  analyzedAtCommit?: string;                      // File (git commit hash at which file was last analyzed)
  // Shared node properties
  kind?: "codebase" | "knowledge" | "project";
  source?: "code-analysis" | "concept" | "wiki";
  // Risk node properties
  severity?: "low" | "medium" | "high" | "critical";
  probability?: "low" | "medium" | "high";
  mitigation?: string;
  // Freshness metadata
  sourceFiles?: string[];
  generatedAt?: string;
  sourceCommit?: string;
}

// GraphEdge with rich relationship modeling
export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  description?: string;
  weight: number; // 0-1
}

// Layer (logical grouping)
export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}

// TourStep (for learn mode)
export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}

// ProjectMeta
export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
}

// Root KnowledgeGraph
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge" | "project";
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
}

// Theme configuration (for dashboard customization)
export interface ThemeConfig {
  presetId: string;
  accentId: string;
}

// Project singleton meta — DEPRECATED.
// The four fields used to live on the Project singleton node (kind: "project")
// in Neo4j, but they have all been migrated to better homes:
//   - gitCommitHash → max(File.analyzedAtCommit) (Cypher aggregate)
//   - lastAnalyzedAt → max(File.analyzedAt) (Cypher aggregate)
//   - analyzedFiles → count(:File) (Cypher aggregate)
//   - version → .grasp-it/config.json
// Kept as an empty interface for backwards compatibility with existing imports;
// new code should not reference it.
export interface ProjectSingletonMeta {}

// AnalysisMeta (for persistence) — kept for legacy callers.
// New code should derive these values from File-node aggregations and config.json.
export interface AnalysisMeta {
  lastAnalyzedAt?: string;
  gitCommitHash?: string;
  version?: string;
  analyzedFiles?: number;
  theme?: ThemeConfig;
  domainGraphStale?: boolean;
}

// Project config (for auto-update opt-in and language preference)
// `version` is the schema version of the assembled knowledge graph (read+written here).
// `autoUpdate` is required as the primary opt-in flag; `saveConfig` merges any
// partial config with the defaults so callers can omit it when only writing
// `version` or `outputLanguage`.
export interface ProjectConfig {
  autoUpdate?: boolean;
  outputLanguage?: string;
  version?: string;
}

// Non-code structural sub-interfaces
export interface SectionInfo {
  name: string;
  level: number;
  lineRange: [number, number];
}

export interface DefinitionInfo {
  name: string;
  /** Parser-reported definition kind. Known values: "table", "view", "index", "message", "enum", "type", "input", "interface", "union", "scalar", "variable", "output", "resource", "data", "section", "target", "stage" */
  kind: string;
  lineRange: [number, number];
  fields: string[];
}

export interface ServiceInfo {
  name: string;
  image?: string;
  ports: number[];
  lineRange?: [number, number];
}

export interface EndpointInfo {
  method?: string;
  path: string;
  lineRange: [number, number];
}

export interface StepInfo {
  name: string;
  lineRange: [number, number];
}

export interface ResourceInfo {
  name: string;
  kind: string;
  lineRange: [number, number];
}

export interface ReferenceResolution {
  source: string;
  target: string;
  referenceType: string; // "file", "image", "schema", "service"
  line?: number;
}

// Plugin interfaces
export interface StructuralAnalysis {
  functions: Array<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }>;
  classes: Array<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[] }>;
  imports: Array<{ source: string; specifiers: string[]; lineNumber: number }>;
  exports: Array<{ name: string; lineNumber: number; isDefault?: boolean }>;
  // Non-code structural data (all optional for backward compat)
  sections?: SectionInfo[];
  definitions?: DefinitionInfo[];
  services?: ServiceInfo[];
  endpoints?: EndpointInfo[];
  steps?: StepInfo[];
  resources?: ResourceInfo[];
}

export interface ImportResolution {
  source: string;
  resolvedPath: string;
  specifiers: string[];
}

export interface CallGraphEntry {
  caller: string;
  callee: string;
  lineNumber: number;
}

export interface AnalyzerPlugin {
  name: string;
  languages: string[];
  analyzeFile(filePath: string, content: string): StructuralAnalysis;
  resolveImports?(filePath: string, content: string): ImportResolution[];
  extractCallGraph?(filePath: string, content: string): CallGraphEntry[];
  extractReferences?(filePath: string, content: string): ReferenceResolution[];
}
