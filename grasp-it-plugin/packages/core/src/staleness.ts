import { execFileSync } from "child_process";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "./types.js";

export interface StaleImplementedByResult {
  staleEdges: StaleEdge[];
}

export interface StaleEdge {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  filePath: string;
  analyzedAtCommit: string;
}

export interface StalenessResult {
  stale: boolean;
  changedFiles: string[];
}

/**
 * Get the list of files that changed between a given commit and HEAD.
 * Returns an empty array if there are no changes or if git encounters an error.
 */
export function getChangedFiles(
  projectDir: string,
  lastCommitHash: string,
): string[] {
  try {
    const output = execFileSync('git', ['diff', `${lastCommitHash}..HEAD`, '--name-only'], {
      cwd: projectDir,
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Check whether the knowledge graph is stale relative to the current HEAD.
 */
export function isStale(
  projectDir: string,
  lastCommitHash: string,
): StalenessResult {
  const changedFiles = getChangedFiles(projectDir, lastCommitHash);
  return {
    stale: changedFiles.length > 0,
    changedFiles,
  };
}

/**
 * Merge new analysis results into an existing knowledge graph.
 *
 * 1. Remove old nodes belonging to changed files (matched by filePath).
 * 2. Remove old edges where the SOURCE node belongs to a changed file.
 * 3. Add new nodes and edges.
 * 4. Post-merge: remove edges whose target no longer exists in the merged graph
 *    (handles cross-file dangling edges from unchanged files to renamed/deleted nodes).
 * 5. Update project.gitCommitHash and project.analyzedAt.
 * 6. Return the merged graph.
 */
export function mergeGraphUpdate(
  existingGraph: KnowledgeGraph,
  changedFilePaths: string[],
  newNodes: GraphNode[],
  newEdges: GraphEdge[],
  newCommitHash: string,
): KnowledgeGraph {
  const changedSet = new Set(changedFilePaths);

  // Collect IDs of nodes that belong to changed files (will be removed)
  const removedNodeIds = new Set(
    existingGraph.nodes
      .filter((node) => node.filePath !== undefined && changedSet.has(node.filePath))
      .map((node) => node.id),
  );

  // Keep nodes that don't belong to changed files
  const retainedNodes = existingGraph.nodes.filter(
    (node) => !removedNodeIds.has(node.id),
  );

  // Build the set of new node IDs for the post-merge dangling edge check
  const newNodeIds = new Set(newNodes.map((n) => n.id));

  // Keep edges from unchanged sources, then remove any whose target truly doesn't
  // exist after the merge (target was removed AND not re-created with the same ID).
  // This handles cross-file edges from unchanged files to nodes that were
  // renamed or deleted in a re-analyzed file.
  const cleanedEdges = existingGraph.edges.filter((edge) => {
    // Remove edges whose source was from a changed file (source no longer exists)
    if (removedNodeIds.has(edge.source)) {
      return false;
    }
    // Remove edges whose target no longer exists in the merged graph
    if (removedNodeIds.has(edge.target) && !newNodeIds.has(edge.target)) {
      return false;
    }
    return true;
  });

  return {
    ...existingGraph,
    project: {
      ...existingGraph.project,
      gitCommitHash: newCommitHash,
      analyzedAt: new Date().toISOString(),
    },
    nodes: [...retainedNodes, ...newNodes],
    edges: [...cleanedEdges, ...newEdges],
  };
}

/**
 * Find knowledge nodes whose IMPLEMENTED_BY edges point to files that were
 * re-analyzed at a different (older) commit than the current one.
 *
 * This detects staleness introduced by an incremental update: a knowledge node
 * (Feature, Operation, BusinessRule, etc.) with an IMPLEMENTED_BY edge to a File
 * node whose `analyzedAtCommit` differs from the current commit has stale links —
 * the code it describes has changed since the knowledge was last reviewed.
 *
 * @param graph       The assembled knowledge graph (after merge)
 * @param currentCommit  The git commit hash of the current analysis run
 */
export function findStaleImplementedBy(
  graph: KnowledgeGraph,
  currentCommit: string,
): StaleImplementedByResult {
  // Build a map: file node ID -> analyzedAtCommit
  const fileAnalyzedAt = new Map<string, string | undefined>();
  for (const node of graph.nodes) {
    if (node.type === "file" && node.analyzedAtCommit !== undefined) {
      fileAnalyzedAt.set(node.id, node.analyzedAtCommit);
    }
  }

  // Collect all file node IDs
  const fileNodeIds = new Set<string>(fileAnalyzedAt.keys());

  const staleEdges: StaleEdge[] = [];

  for (const edge of graph.edges) {
    if (edge.type !== "implemented_by") continue;
    // Target must be a file node
    if (!fileNodeIds.has(edge.target)) continue;

    const fileAnalyzed = fileAnalyzedAt.get(edge.target);
    if (fileAnalyzed === undefined) continue; // no analyzedAtCommit on this file

    // If the file was analyzed at a different commit than current, the edge is stale
    if (fileAnalyzed !== currentCommit) {
      const knowledgeNode = graph.nodes.find((n) => n.id === edge.source);
      // Get the File node to report its filePath (which file changed)
      const fileNode = graph.nodes.find((n) => n.id === edge.target);
      if (knowledgeNode) {
        staleEdges.push({
          nodeId: knowledgeNode.id,
          nodeName: knowledgeNode.name,
          nodeType: knowledgeNode.type,
          filePath: fileNode?.filePath ?? "",
          analyzedAtCommit: fileAnalyzed,
        });
      }
    }
  }

  return { staleEdges };
}
