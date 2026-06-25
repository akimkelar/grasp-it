// Neo4j Schema Setup for grasp-it
// Applies all required constraints and indexes before graph data is written.
// Safe to re-run: all constraints/indexes use IF NOT EXISTS / IF NOT EXISTS guards.

// =============================================================================
// UNIQUE ID CONSTRAINTS (one per node label)
// =============================================================================

CREATE CONSTRAINT file_id IF NOT EXISTS FOR (n:File) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT function_id IF NOT EXISTS FOR (n:Function) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT class_id IF NOT EXISTS FOR (n:Class) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT module_id IF NOT EXISTS FOR (n:Module) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT config_id IF NOT EXISTS FOR (n:Config) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT table_id IF NOT EXISTS FOR (n:Table) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT endpoint_id IF NOT EXISTS FOR (n:Endpoint) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT domain_id IF NOT EXISTS FOR (n:Domain) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT feature_id IF NOT EXISTS FOR (n:Feature) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT operation_id IF NOT EXISTS FOR (n:Operation) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT actor_id IF NOT EXISTS FOR (n:Actor) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT businessrule_id IF NOT EXISTS FOR (n:BusinessRule) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT decision_id IF NOT EXISTS FOR (n:Decision) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT constraint_id IF NOT EXISTS FOR (n:Constraint) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (n:Concept) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT claim_id IF NOT EXISTS FOR (n:Claim) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT risk_id IF NOT EXISTS FOR (n:Risk) REQUIRE n.id IS UNIQUE;

// Project singleton — single node per database, holds shared gitCommitHash across users
CREATE CONSTRAINT project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE;
// Distinguishes codebase vs knowledge subgraphs
// =============================================================================

// =============================================================================
// NAME SEARCH INDEXES (kind-scoped for efficient filtering)
// =============================================================================

CREATE INDEX codebase_name IF NOT EXISTS FOR (n:Codebase) ON (n.name);
CREATE INDEX knowledge_name IF NOT EXISTS FOR (n:Knowledge) ON (n.name);

// =============================================================================
// STATUS FILTERING INDEXES
// Enables fast filtering of planned/implemented/partial features and operations
// =============================================================================

CREATE INDEX feature_status IF NOT EXISTS FOR (n:Feature) ON (n.status);
CREATE INDEX operation_status IF NOT EXISTS FOR (n:Operation) ON (n.status);

// =============================================================================
// SOURCE FILTERING INDEX
// Enables efficient queries like "all nodes produced from concept plans" vs "all nodes mined from code"
// =============================================================================

CREATE INDEX knowledge_source IF NOT EXISTS FOR (n:Knowledge) ON (n.source);

// =============================================================================
// RISK SEVERITY FILTERING INDEX
// Enables filtering risks by severity without scanning all Risk nodes
// =============================================================================

CREATE INDEX risk_severity IF NOT EXISTS FOR (n:Risk) ON (n.severity);

// =============================================================================
// COMPLEXITY FILTERING INDEX
// Enables fast lookup of complex functions for review
// =============================================================================

CREATE INDEX function_complexity IF NOT EXISTS FOR (n:Function) ON (n.complexity);

// =============================================================================
// TAG FILTERING INDEXES (kind-scoped)
// Enables tag-based discovery across both subgraphs
// =============================================================================

CREATE INDEX codebase_tags IF NOT EXISTS FOR (n:Codebase) ON (n.tags);
CREATE INDEX knowledge_tags IF NOT EXISTS FOR (n:Knowledge) ON (n.tags);