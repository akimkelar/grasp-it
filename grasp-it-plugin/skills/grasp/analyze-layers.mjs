#!/usr/bin/env node
/**
 * analyze-layers.mjs — Deterministic architecture layer analysis backbone.
 *
 * Reads file-nodes + import-edges + all-edges JSON and computes structural
 * patterns that inform layer identification. Replaces the LLM-written per-run
 * script that was previously generated in architecture-analyzer.md Phase 1.
 *
 * Usage:
 *   node analyze-layers.mjs <input.json> <output.json>
 *
 * Input JSON shape:
 *   {
 *     "fileNodes": [{ "id", "type", "name", "filePath", "summary", "tags" }, ...],
 *     "importEdges": [{ "source", "target", "type" }, ...],
 *     "allEdges": [{ "source", "target", "type" }, ...]
 *   }
 *
 * Output JSON shape: matches architecture-analyzer.md:228–296 schema exactly.
 */

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Pattern matching tables (from architecture-analyzer.md:107–167)
// ---------------------------------------------------------------------------

/**
 * Directory name → pattern label.
 * Order matters: first match wins (but we check all so it doesn't matter here).
 */
const DIR_PATTERN_MAP = [
  // [[directory patterns], label]
  [['routes', 'api', 'controllers', 'endpoints', 'handlers'], 'api'],
  [['services', 'core', 'lib', 'domain', 'logic'], 'service'],
  [['models', 'db', 'data', 'persistence', 'repository', 'entities'], 'data'],
  [['components', 'views', 'pages', 'ui', 'layouts', 'screens'], 'ui'],
  [['middleware', 'plugins', 'interceptors', 'guards'], 'middleware'],
  [['utils', 'helpers', 'common', 'shared', 'tools'], 'utility'],
  [['config', 'constants', 'env', 'settings'], 'config'],
  [['__tests__', 'test', 'tests', 'spec', 'specs'], 'test'],
  [['types', 'interfaces', 'schemas', 'contracts', 'dtos'], 'types'],
  [['hooks'], 'hooks'],
  [['store', 'state', 'reducers', 'actions', 'slices'], 'state'],
  [['assets', 'static', 'public'], 'assets'],
  [['migrations'], 'data'],
  [['management', 'commands'], 'config'],
  [['templatetags'], 'utility'],
  [['signals'], 'service'],
  [['serializers'], 'api'],
  [['cmd'], 'entry'],
  [['internal'], 'service'],
  [['pkg'], 'utility'],
  [['dto', 'request', 'response'], 'types'],
  [['entity'], 'data'],
  [['controller'], 'api'],
  [['routers'], 'api'],
  [['composables'], 'service'],
  [['blueprints'], 'api'],
  [['mailers', 'jobs', 'channels'], 'service'],
  [['bin'], 'entry'],
  [['docs', 'documentation', 'wiki'], 'documentation'],
  [['deploy', 'deployment', 'infra', 'infrastructure'], 'infrastructure'],
  [['.github', '.gitlab', '.circleci'], 'ci-cd'],
  [['k8s', 'kubernetes', 'helm', 'charts'], 'infrastructure'],
  [['terraform', 'tf'], 'infrastructure'],
  [['docker'], 'infrastructure'],
  [['sql', 'database', 'schema'], 'data'],
];

const FILE_PATTERN_LABELS = {
  test: /\b(test_|spec|_test|Test|Tests|\.test\.|\.spec\.)/,
  types: /\.d\.ts$/,
  entry: /^(index|__init__)\.(js|ts|py)$/,
  djangoEntry: /^manage\.py$/,
  wsgi: /^(wsgi|asgi)\.py$/,
  goEntry: /^main\.go$/,
  rustEntry: /^(main|lib)\.rs$/,
  jvmEntry: /^(Application|Program)\.(java|cs)$/,
  rackEntry: /^config\.ru$/,
  langConfig: /^(Cargo\.toml|go\.mod|Gemfile|pom\.xml|build\.gradle|composer\.json)$/,
  infra: /^Dockerfile$/,
  compose: /^docker-compose\./,
  tf: /\.(tf|tfvars)$/,
  ciCd: /^(\.github\/workflows|\.gitlab-ci|\.circleci|Jenkinsfile)/,
  sql: /\.sql$/,
  graphqlSchema: /\.(graphql|gql|proto)$/,
  doc: /\.(md|rst)$/,
  makefile: /^Makefile$/,
};

/**
 * Classify a directory name against known patterns.
 * Returns the first matching label or null.
 */
function classifyDir(dirName) {
  for (const [dirs, label] of DIR_PATTERN_MAP) {
    if (dirs.includes(dirName)) return label;
  }
  return null;
}

/**
 * Classify a file path against known patterns.
 * Returns a label or null.
 */
function classifyFile(filePath) {
  const base = filePath.split('/').pop();
  const posix = filePath.split('/').join('/');

  for (const [pattern, label] of Object.entries(FILE_PATTERN_LABELS)) {
    if (pattern.startsWith('.')) {
      // Path-based
      if (posix.includes(pattern)) return label;
    } else if (pattern.startsWith('^')) {
      if (new RegExp(pattern).test(base)) return label;
    } else {
      if (base === pattern || base.startsWith(pattern + '.')) return label;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core computations
// ---------------------------------------------------------------------------

/**
 * Compute the common prefix of all file paths.
 */
function commonPrefix(paths) {
  if (!paths || paths.length === 0) return '';
  const split = p => p.split('/');
  const segs = paths.map(split);
  let common = [];
  for (let i = 0; i < segs[0].length; i++) {
    const s = segs[0][i];
    if (segs.every(seg => seg[i] === s)) {
      common.push(s);
    } else break;
  }
  return common.join('/');
}

/**
 * Get the directory group for a file path given the common prefix.
 * e.g. with prefix "src/", "src/routes/index.ts" → "routes"
 */
function dirGroup(filePath, commonPrefix_) {
  const prefixSegs = commonPrefix_ ? commonPrefix_.split('/').length : 0;
  const segs = filePath.split('/');
  return segs[prefixSegs] || '_root';
}

/**
 * Build directory groups from fileNodes.
 */
function buildDirectoryGroups(fileNodes) {
  const paths = fileNodes.map(n => n.filePath || n.id.replace(/^[^:]+:/, ''));
  const prefix = commonPrefix(paths);

  const groups = new Map();
  for (const node of fileNodes) {
    const fp = node.filePath || node.id.replace(/^[^:]+:/, '');
    const group = dirGroup(fp, prefix);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(node.id);
  }

  // Sort groups deterministically
  const sorted = {};
  for (const [k, v] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sorted[k] = v.sort();
  }
  return sorted;
}

/**
 * Build node type groups from fileNodes.
 */
function buildNodeTypeGroups(fileNodes) {
  const groups = new Map();
  for (const node of fileNodes) {
    const type = node.type || 'file';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(node.id);
  }
  const sorted = {};
  for (const [k, v] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sorted[k] = v.sort();
  }
  return sorted;
}

/**
 * Build adjacency list from import edges.
 */
function buildAdjacency(importEdges) {
  const out = new Map();
  const in_ = new Map();
  for (const edge of importEdges) {
    if (!out.has(edge.source)) out.set(edge.source, new Set());
    out.get(edge.source).add(edge.target);
    if (!in_.has(edge.target)) in_.set(edge.target, new Set());
    in_.get(edge.target).add(edge.source);
  }
  return { out, in_ };
}

/**
 * Build directory-level adjacency from import edges + directory groups.
 */
function buildDirAdjacency(importEdges, dirGroups, idToDir) {
  const dirOut = new Map();
  const dirIn = new Map();

  for (const edge of importEdges) {
    const srcDir = idToDir.get(edge.source);
    const tgtDir = idToDir.get(edge.target);
    if (!srcDir || !tgtDir) continue;
    if (srcDir === tgtDir) continue; // handled separately
    if (!dirOut.has(srcDir)) dirOut.set(srcDir, new Set());
    dirOut.get(srcDir).add(tgtDir);
    if (!dirIn.has(tgtDir)) dirIn.set(tgtDir, new Set());
    dirIn.get(tgtDir).add(srcDir);
  }

  const result = {};
  const allDirs = new Set([...dirOut.keys(), ...dirIn.keys()]);
  for (const d of [...allDirs].sort()) {
    result[d] = {
      importsFrom: [...(dirOut.get(d) || new Set())].sort(),
      importedBy: [...(dirIn.get(d) || new Set())].sort(),
    };
  }
  return result;
}

/**
 * Cross-category dependency analysis using allEdges.
 */
function buildCrossCategoryEdges(allEdges) {
  const counts = new Map();
  for (const edge of allEdges) {
    // Extract source/target type from id prefix
    const srcType = edge.source.replace(/:.*/, '');
    const tgtType = edge.target.replace(/:.*/, '');
    if (srcType === tgtType && srcType === 'file') continue; // skip file→file imports
    const key = `${srcType}:${tgtType}:${edge.type}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => {
      const [fromType, toType, edgeType] = key.split(':');
      return { fromType, toType, edgeType, count };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Inter-group import frequency matrix.
 */
function buildInterGroupImports(importEdges, dirGroups, idToDir) {
  const matrix = new Map();

  for (const edge of importEdges) {
    const srcDir = idToDir.get(edge.source);
    const tgtDir = idToDir.get(edge.target);
    if (!srcDir || !tgtDir) continue;
    if (srcDir === tgtDir) continue;
    const key = `${srcDir}:${tgtDir}`;
    matrix.set(key, (matrix.get(key) || 0) + 1);
  }

  return [...matrix.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(':');
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
}

/**
 * Intra-group density for each directory group.
 */
function buildIntraGroupDensity(importEdges, dirGroups, idToDir) {
  const totalByDir = new Map();
  const internalByDir = new Map();

  for (const edge of importEdges) {
    const srcDir = idToDir.get(edge.source);
    const tgtDir = idToDir.get(edge.target);
    if (!srcDir || !tgtDir) continue;
    totalByDir.set(srcDir, (totalByDir.get(srcDir) || 0) + 1);
    totalByDir.set(tgtDir, (totalByDir.get(tgtDir) || 0) + 1);
    if (srcDir === tgtDir) {
      internalByDir.set(srcDir, (internalByDir.get(srcDir) || 0) + 1);
    }
  }

  const density = {};
  for (const [dir, group] of Object.entries(dirGroups)) {
    const total = totalByDir.get(dir) || 0;
    const internal = internalByDir.get(dir) || 0;
    density[dir] = {
      internalEdges: internal,
      totalEdges: total,
      density: total > 0 ? internal / total : 0,
    };
  }
  return density;
}

/**
 * Pattern matches for each directory group.
 */
function buildPatternMatches(dirGroups) {
  const matches = {};
  for (const dir of Object.keys(dirGroups)) {
    const label = classifyDir(dir);
    if (label) matches[dir] = label;
  }
  return matches;
}

/**
 * Deployment topology detection.
 */
function buildDeploymentTopology(fileNodes) {
  const infraTypes = new Set(['service', 'resource', 'pipeline']);
  const infraFiles = fileNodes
    .filter(n => infraTypes.has(n.type) || /\.(tf|tfvars|ya?ml)$/.test(n.filePath || ''))
    .map(n => n.filePath || n.id.replace(/^[^:]+:/, ''));

  const hasDockerfile = infraFiles.some(f => /^Dockerfile/.test(f) || f.includes('docker'));
  const hasCompose = infraFiles.some(f => /^docker-compose/.test(f) || f === 'compose.yml' || f === 'compose.yaml');
  const hasK8s = infraFiles.some(f => /\/k8s\//.test(f) || /\/kubernetes\//.test(f) || /\.k8s\.ya?ml$/i.test(f));
  const hasTerraform = infraFiles.some(f => /\.tf$/.test(f));
  const hasCI = infraFiles.some(f => /\.github\/workflows\//.test(f) || /\.gitlab-ci/.test(f) || /\.circleci\//.test(f) || /^Jenkinsfile$/.test(f));

  return {
    hasDockerfile,
    hasCompose,
    hasK8s,
    hasTerraform,
    hasCI,
    infraFiles,
  };
}

/**
 * Data pipeline detection.
 */
function buildDataPipeline(fileNodes) {
  const schemaFiles = fileNodes
    .filter(n => /\.(graphql|gql|proto|prisma|sql)$/.test(n.filePath || ''))
    .map(n => n.filePath || n.id.replace(/^[^:]+:/, ''));

  const migrationFiles = fileNodes
    .filter(n => /migrations?\/.*\.sql$/i.test(n.filePath || ''))
    .map(n => n.filePath || n.id.replace(/^[^:]+:/, ''));

  const dataModelFiles = fileNodes
    .filter(n => (n.type === 'file' || n.type === 'class') &&
      /(model|entity|schema|table)/i.test(n.name || ''))
    .map(n => n.filePath || n.id.replace(/^[^:]+:/, ''));

  const apiHandlerFiles = fileNodes
    .filter(n => (n.type === 'file' || n.type === 'endpoint') &&
      /(route|handler|controller|endpoint|api)/i.test(n.name || ''))
    .map(n => n.filePath || n.id.replace(/^[^:]+:/, ''));

  return {
    schemaFiles,
    migrationFiles,
    dataModelFiles,
    apiHandlerFiles,
  };
}

/**
 * Documentation coverage per directory group.
 * For a doc file like src/routes/README.md, associate it with the directory
 * group that is the first segment after the common prefix (e.g., "routes").
 */
function buildDocCoverage(fileNodes, dirGroups, commonPrefix_) {
  const prefixSegs = commonPrefix_ ? commonPrefix_.split('/').filter(Boolean).length : 0;
  // The directory group for a doc is the segment immediately after the prefix.
  // e.g. prefix="src/" (1 seg), doc at "src/routes/README.md" -> group is segs[1]="routes".

  const groupHasDoc = new Set();
  for (const node of fileNodes) {
    if (node.type === 'document') {
      const fp = node.filePath || node.id.replace(/^[^:]+:/, '');
      const segs = fp.split('/').filter(Boolean);
      // A doc is associated with the directory that immediately follows the prefix.
      if (segs.length > prefixSegs) {
        groupHasDoc.add(segs[prefixSegs]);
      }
    }
  }

  const totalGroups = Object.keys(dirGroups).length;
  const groupsWithDocs = [...groupHasDoc].filter(g => Object.prototype.hasOwnProperty.call(dirGroups, g)).length;
  const undocumentedGroups = Object.keys(dirGroups).filter(g => !groupHasDoc.has(g));

  return {
    groupsWithDocs,
    totalGroups,
    coverageRatio: totalGroups > 0 ? groupsWithDocs / totalGroups : 0,
    undocumentedGroups,
  };
}

/**
 * Dependency direction between groups based on inter-group import imbalance.
 */
function buildDependencyDirection(interGroupImports, dirGroups) {
  const depCount = new Map();
  for (const { from, to, count } of interGroupImports) {
    const key = `${from}:${to}`;
    depCount.set(key, (depCount.get(key) || 0) + count);
  }

  const direction = [];
  const dirs = Object.keys(dirGroups);

  for (let i = 0; i < dirs.length; i++) {
    for (let j = 0; j < dirs.length; j++) {
      if (i === j) continue;
      const a = dirs[i];
      const b = dirs[j];
      const ab = depCount.get(`${a}:${b}`) || 0;
      const ba = depCount.get(`${b}:${a}`) || 0;
      if (ab > 0 && ab > ba) {
        direction.push({ dependent: a, dependsOn: b });
      }
    }
  }

  return direction;
}

/**
 * Fan-in / fan-out per file node.
 */
function buildFileFan(importEdges) {
  const fanOut = new Map();
  const fanIn = new Map();

  for (const edge of importEdges) {
    fanOut.set(edge.source, (fanOut.get(edge.source) || 0) + 1);
    fanIn.set(edge.target, (fanIn.get(edge.target) || 0) + 1);
  }

  return { fanOut: Object.fromEntries(fanOut), fanIn: Object.fromEntries(fanIn) };
}

/**
 * File stats: total count + per-group count + per-type count.
 */
function buildFileStats(fileNodes, dirGroups, nodeTypeGroups) {
  return {
    totalFileNodes: fileNodes.length,
    filesPerGroup: Object.fromEntries(
      Object.entries(dirGroups).map(([k, v]) => [k, v.length])
    ),
    nodeTypeCounts: Object.fromEntries(
      Object.entries(nodeTypeGroups).map(([k, v]) => [k, v.length])
    ),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node analyze-layers.mjs <input.json> <output.json>\n');
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(readFileSync(inputPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`analyze-layers.mjs: failed to read input: ${err.message}\n`);
    process.exit(1);
  }

  const { fileNodes = [], importEdges = [], allEdges = [] } = input;

  // Build directory groups
  const dirGroups = buildDirectoryGroups(fileNodes);

  // Build node type groups
  const nodeTypeGroups = buildNodeTypeGroups(fileNodes);

  // Build id → dir mapping
  const prefix = commonPrefix(fileNodes.map(n => n.filePath || n.id.replace(/^[^:]+:/, '')));
  const idToDir = new Map();
  for (const node of fileNodes) {
    const fp = node.filePath || node.id.replace(/^[^:]+:/, '');
    idToDir.set(node.id, dirGroup(fp, prefix));
  }

  // Cross-category edges
  const crossCategoryEdges = buildCrossCategoryEdges(allEdges);

  // Inter-group import matrix
  const interGroupImports = buildInterGroupImports(importEdges, dirGroups, idToDir);

  // Intra-group density
  const intraGroupDensity = buildIntraGroupDensity(importEdges, dirGroups, idToDir);

  // Pattern matches
  const patternMatches = buildPatternMatches(dirGroups);

  // Deployment topology
  const deploymentTopology = buildDeploymentTopology(fileNodes);

  // Data pipeline
  const dataPipeline = buildDataPipeline(fileNodes);

  // Doc coverage
  const docCoverage = buildDocCoverage(fileNodes, dirGroups, prefix);

  // Dependency direction
  const dependencyDirection = buildDependencyDirection(interGroupImports, dirGroups);

  // Fan in/out
  const { fanOut, fanIn } = buildFileFan(importEdges);

  // File stats
  const fileStats = buildFileStats(fileNodes, dirGroups, nodeTypeGroups);

  const output = {
    scriptCompleted: true,
    directoryGroups: dirGroups,
    nodeTypeGroups,
    crossCategoryEdges,
    interGroupImports,
    intraGroupDensity,
    patternMatches,
    deploymentTopology,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats,
    fileFanIn: fanIn,
    fileFanOut: fanOut,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  process.stderr.write(
    `analyze-layers: ${fileNodes.length} files in ${Object.keys(dirGroups).length} groups → ${outputPath}\n`,
  );
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(process.argv[1]);
    return modulePath === argvPath;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`analyze-layers.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

export {
  classifyDir,
  classifyFile,
  commonPrefix,
  dirGroup,
  buildDirectoryGroups,
  buildNodeTypeGroups,
  buildCrossCategoryEdges,
  buildInterGroupImports,
  buildIntraGroupDensity,
  buildPatternMatches,
  buildDeploymentTopology,
  buildDataPipeline,
  buildDocCoverage,
  buildDependencyDirection,
  buildFileFan,
  buildFileStats,
};
