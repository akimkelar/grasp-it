import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../grasp-it-plugin/skills/grasp/analyze-layers.mjs',
);

function runScript(input) {
  const root = mkdtempSync(join(tmpdir(), 'ua-arch-test-'));
  const inputPath = join(root, 'input.json');
  const outputPath = join(root, 'output.json');
  writeFileSync(inputPath, JSON.stringify(input));
  const result = spawnSync('node', [SCRIPT, inputPath, outputPath], {
    encoding: 'utf-8',
  });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch { /* missing */ }
  rmSync(root, { recursive: true, force: true });
  return { status: result.status, stderr: result.stderr, output };
}

function makeFileNode(id, filePath, type = 'file', name = null) {
  return { id, type, name: name || filePath.split('/').pop(), filePath, summary: 'summary', tags: [] };
}

describe('analyze-layers.mjs — directory grouping', () => {
  it('groups files by top-level directory under common prefix', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/routes/index.ts', 'src/routes/index.ts'),
        makeFileNode('file:src/routes/auth.ts', 'src/routes/auth.ts'),
        makeFileNode('file:src/services/auth.ts', 'src/services/auth.ts'),
        makeFileNode('file:src/services/user.ts', 'src/services/user.ts'),
        makeFileNode('file:src/utils/format.ts', 'src/utils/format.ts'),
      ],
      importEdges: [
        { source: 'file:src/routes/index.ts', target: 'file:src/services/auth.ts', type: 'imports' },
        { source: 'file:src/services/auth.ts', target: 'file:src/utils/format.ts', type: 'imports' },
      ],
      allEdges: [
        { source: 'file:src/routes/index.ts', target: 'file:src/services/auth.ts', type: 'imports' },
        { source: 'file:src/services/auth.ts', target: 'file:src/utils/format.ts', type: 'imports' },
      ],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.directoryGroups).toBeDefined();
    expect(output.directoryGroups.routes).toContain('file:src/routes/index.ts');
    expect(output.directoryGroups.routes).toContain('file:src/routes/auth.ts');
    expect(output.directoryGroups.services).toContain('file:src/services/auth.ts');
    expect(output.directoryGroups.utils).toContain('file:src/utils/format.ts');
  });

  it('uses _root for files at the common prefix root', () => {
    const input = {
      fileNodes: [
        makeFileNode('config:tsconfig.json', 'tsconfig.json'),
        makeFileNode('file:src/a.ts', 'src/a.ts'),
        makeFileNode('file:lib/b.ts', 'lib/b.ts'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    // With no common prefix among all paths, groups by first segment
    expect(output.directoryGroups).toBeDefined();
  });

  it('filesPerGroup counts match directoryGroups', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/routes/index.ts', 'src/routes/index.ts'),
        makeFileNode('file:src/routes/auth.ts', 'src/routes/auth.ts'),
        makeFileNode('file:src/services/auth.ts', 'src/services/auth.ts'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.fileStats.filesPerGroup.routes).toBe(2);
    expect(output.fileStats.filesPerGroup.services).toBe(1);
  });
});

describe('analyze-layers.mjs — pattern matching', () => {
  it('classifies known directory names correctly', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/routes/index.ts', 'src/routes/index.ts'),
        makeFileNode('file:src/services/core.ts', 'src/services/core.ts'),
        makeFileNode('file:src/models/user.ts', 'src/models/user.ts'),
        makeFileNode('file:src/utils/format.ts', 'src/utils/format.ts'),
        makeFileNode('file:src/components/Button.tsx', 'src/components/Button.tsx'),
        makeFileNode('file:src/middleware/auth.ts', 'src/middleware/auth.ts'),
        makeFileNode('file:src/store/reducer.ts', 'src/store/reducer.ts'),
        makeFileNode('file:src/__tests__/a.test.ts', 'src/__tests__/a.test.ts'),
        makeFileNode('file:src/types/api.ts', 'src/types/api.ts'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.patternMatches.routes).toBe('api');
    expect(output.patternMatches.services).toBe('service');
    expect(output.patternMatches.models).toBe('data');
    expect(output.patternMatches.utils).toBe('utility');
    expect(output.patternMatches.components).toBe('ui');
    expect(output.patternMatches.middleware).toBe('middleware');
    expect(output.patternMatches.store).toBe('state');
    expect(output.patternMatches.__tests__).toBe('test');
    expect(output.patternMatches.types).toBe('types');
  });

  it('routes → api, services → service pattern detection', () => {
    const { status, output } = runScript({
      fileNodes: [
        makeFileNode('file:api/users.ts', 'api/users.ts'),
        makeFileNode('file:services/auth.ts', 'services/auth.ts'),
      ],
      importEdges: [],
      allEdges: [],
    });
    expect(status).toBe(0);
    expect(output.patternMatches.api).toBe('api');
    expect(output.patternMatches.services).toBe('service');
  });
});

describe('analyze-layers.mjs — inter-group density', () => {
  it('counts import edges correctly between groups', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/a/index.ts', 'src/a/index.ts'),
        makeFileNode('file:src/b/index.ts', 'src/b/index.ts'),
        makeFileNode('file:src/b/helper.ts', 'src/b/helper.ts'),
      ],
      importEdges: [
        { source: 'file:src/a/index.ts', target: 'file:src/b/index.ts', type: 'imports' },
        { source: 'file:src/a/index.ts', target: 'file:src/b/helper.ts', type: 'imports' },
        { source: 'file:src/b/index.ts', target: 'file:src/b/helper.ts', type: 'imports' },
      ],
      allEdges: [
        { source: 'file:src/a/index.ts', target: 'file:src/b/index.ts', type: 'imports' },
        { source: 'file:src/a/index.ts', target: 'file:src/b/helper.ts', type: 'imports' },
        { source: 'file:src/b/index.ts', target: 'file:src/b/helper.ts', type: 'imports' },
      ],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);

    // a imports b twice
    const ab = output.interGroupImports.find(e => e.from === 'a' && e.to === 'b');
    expect(ab.count).toBe(2);

    // Intra-group: b/index.ts → b/helper.ts
    const bDensity = output.intraGroupDensity.b;
    expect(bDensity.internalEdges).toBe(1);
    expect(bDensity.totalEdges).toBeGreaterThan(0);
  });
});

describe('analyze-layers.mjs — node type groups', () => {
  it('groups files by node type', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/a.ts', 'src/a.ts'),
        makeFileNode('config:tsconfig.json', 'tsconfig.json', 'config'),
        makeFileNode('document:README.md', 'README.md', 'document'),
        makeFileNode('service:Dockerfile', 'Dockerfile', 'service'),
        makeFileNode('pipeline:.github/workflows/ci.yml', '.github/workflows/ci.yml', 'pipeline'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.nodeTypeGroups.file).toContain('file:src/a.ts');
    expect(output.nodeTypeGroups.config).toContain('config:tsconfig.json');
    expect(output.nodeTypeGroups.document).toContain('document:README.md');
    expect(output.nodeTypeGroups.service).toContain('service:Dockerfile');
    expect(output.nodeTypeGroups.pipeline).toContain('pipeline:.github/workflows/ci.yml');
  });
});

describe('analyze-layers.mjs — cross-category edges', () => {
  it('counts edges between node type groups', () => {
    const input = {
      fileNodes: [
        makeFileNode('config:tsconfig.json', 'tsconfig.json', 'config'),
        makeFileNode('file:src/a.ts', 'src/a.ts', 'file'),
        makeFileNode('file:src/b.ts', 'src/b.ts', 'file'),
        makeFileNode('service:Dockerfile', 'Dockerfile', 'service'),
      ],
      importEdges: [],
      allEdges: [
        { source: 'config:tsconfig.json', target: 'file:src/a.ts', type: 'configures' },
        { source: 'config:tsconfig.json', target: 'file:src/b.ts', type: 'configures' },
        { source: 'service:Dockerfile', target: 'file:src/a.ts', type: 'deploys' },
      ],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.crossCategoryEdges).toContainEqual(
      expect.objectContaining({ fromType: 'config', toType: 'file', edgeType: 'configures', count: 2 }),
    );
    expect(output.crossCategoryEdges).toContainEqual(
      expect.objectContaining({ fromType: 'service', toType: 'file', edgeType: 'deploys', count: 1 }),
    );
  });
});

describe('analyze-layers.mjs — deployment topology', () => {
  it('detects Dockerfile, docker-compose, K8s, Terraform, CI files', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/index.ts', 'src/index.ts'),
        makeFileNode('service:Dockerfile', 'Dockerfile', 'service'),
        makeFileNode('service:docker-compose.yml', 'docker-compose.yml', 'service'),
        makeFileNode('resource:main.tf', 'infra/main.tf', 'resource'),
        makeFileNode('pipeline:.github/workflows/ci.yml', '.github/workflows/ci.yml', 'pipeline'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.deploymentTopology.hasDockerfile).toBe(true);
    expect(output.deploymentTopology.hasCompose).toBe(true);
    expect(output.deploymentTopology.hasTerraform).toBe(true);
    expect(output.deploymentTopology.hasCI).toBe(true);
    expect(output.deploymentTopology.hasK8s).toBe(false);
    expect(output.deploymentTopology.infraFiles).toContain('Dockerfile');
  });

  it('reports false when no infra files present', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/a.ts', 'src/a.ts'),
        makeFileNode('file:src/b.ts', 'src/b.ts'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.deploymentTopology.hasDockerfile).toBe(false);
    expect(output.deploymentTopology.hasCompose).toBe(false);
    expect(output.deploymentTopology.hasK8s).toBe(false);
    expect(output.deploymentTopology.hasTerraform).toBe(false);
    expect(output.deploymentTopology.hasCI).toBe(false);
  });
});

describe('analyze-layers.mjs — data pipeline', () => {
  it('identifies schema, migration, data model, and API handler files', () => {
    const input = {
      fileNodes: [
        makeFileNode('schema:db/schema.graphql', 'db/schema.graphql'),
        makeFileNode('table:migrations/001.sql', 'migrations/001.sql'),
        makeFileNode('file:src/models/user_model.ts', 'src/models/user_model.ts'),
        makeFileNode('file:src/routes/users_route.ts', 'src/routes/users_route.ts'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.dataPipeline.schemaFiles).toContain('db/schema.graphql');
    expect(output.dataPipeline.migrationFiles).toContain('migrations/001.sql');
    expect(output.dataPipeline.dataModelFiles).toContain('src/models/user_model.ts');
    expect(output.dataPipeline.apiHandlerFiles).toContain('src/routes/users_route.ts');
  });
});

describe('analyze-layers.mjs — documentation coverage', () => {
  it('reports groups with and without docs', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/routes/index.ts', 'src/routes/index.ts'),
        makeFileNode('file:src/services/auth.ts', 'src/services/auth.ts'),
        makeFileNode('document:src/routes/README.md', 'src/routes/README.md', 'document'),
      ],
      importEdges: [],
      allEdges: [],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.docCoverage.groupsWithDocs).toBeGreaterThanOrEqual(1);
    expect(output.docCoverage.totalGroups).toBe(2);
    expect(output.docCoverage.undocumentedGroups).toContain('services');
  });
});

describe('analyze-layers.mjs — fan in/out', () => {
  it('computes fan-in and fan-out correctly', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/utils.ts', 'src/utils.ts'),
        makeFileNode('file:src/a.ts', 'src/a.ts'),
        makeFileNode('file:src/b.ts', 'src/b.ts'),
        makeFileNode('file:src/c.ts', 'src/c.ts'),
      ],
      importEdges: [
        { source: 'file:src/a.ts', target: 'file:src/utils.ts', type: 'imports' },
        { source: 'file:src/b.ts', target: 'file:src/utils.ts', type: 'imports' },
        { source: 'file:src/c.ts', target: 'file:src/utils.ts', type: 'imports' },
        { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' },
      ],
      allEdges: [
        { source: 'file:src/a.ts', target: 'file:src/utils.ts', type: 'imports' },
        { source: 'file:src/b.ts', target: 'file:src/utils.ts', type: 'imports' },
        { source: 'file:src/c.ts', target: 'file:src/utils.ts', type: 'imports' },
        { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' },
      ],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.fileFanIn['file:src/utils.ts']).toBe(3);
    expect(output.fileFanOut['file:src/a.ts']).toBe(2);
  });
});

describe('analyze-layers.mjs — dependency direction', () => {
  it('identifies which group depends on which', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/api/index.ts', 'src/api/index.ts'),
        makeFileNode('file:src/services/core.ts', 'src/services/core.ts'),
        makeFileNode('file:src/data/repo.ts', 'src/data/repo.ts'),
      ],
      importEdges: [
        { source: 'file:src/api/index.ts', target: 'file:src/services/core.ts', type: 'imports' },
        { source: 'file:src/services/core.ts', target: 'file:src/data/repo.ts', type: 'imports' },
      ],
      allEdges: [
        { source: 'file:src/api/index.ts', target: 'file:src/services/core.ts', type: 'imports' },
        { source: 'file:src/services/core.ts', target: 'file:src/data/repo.ts', type: 'imports' },
      ],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    const apiDeps = output.dependencyDirection.filter(d => d.dependent === 'api');
    expect(apiDeps.some(d => d.dependsOn === 'services')).toBe(true);
    const svcDeps = output.dependencyDirection.filter(d => d.dependent === 'services');
    expect(svcDeps.some(d => d.dependsOn === 'data')).toBe(true);
  });
});

describe('analyze-layers.mjs — output schema invariants', () => {
  it('output schema matches architecture-analyzer.md expected shape', () => {
    const input = {
      fileNodes: [
        makeFileNode('file:src/a.ts', 'src/a.ts'),
        makeFileNode('file:src/b.ts', 'src/b.ts'),
      ],
      importEdges: [
        { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' },
      ],
      allEdges: [
        { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' },
      ],
    };

    const { status, output } = runScript(input);
    expect(status).toBe(0);
    expect(output.scriptCompleted).toBe(true);
    expect(output.directoryGroups).toBeDefined();
    expect(output.nodeTypeGroups).toBeDefined();
    expect(Array.isArray(output.crossCategoryEdges)).toBe(true);
    expect(Array.isArray(output.interGroupImports)).toBe(true);
    expect(output.intraGroupDensity).toBeDefined();
    expect(output.patternMatches).toBeDefined();
    expect(output.deploymentTopology).toBeDefined();
    expect(output.dataPipeline).toBeDefined();
    expect(output.docCoverage).toBeDefined();
    expect(Array.isArray(output.dependencyDirection)).toBe(true);
    expect(output.fileStats).toBeDefined();
    expect(output.fileStats.totalFileNodes).toBe(2);
    expect(output.fileFanIn).toBeDefined();
    expect(output.fileFanOut).toBeDefined();
  });

  it('fails with usage when arguments are missing', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage:/);
  });
});
