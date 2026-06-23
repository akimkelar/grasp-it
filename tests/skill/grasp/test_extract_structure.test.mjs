import { describe, it, expect } from 'vitest';
import {
  buildResult,
  buildFileNode,
  nodeTypeForFile,
} from '../../../grasp-it-plugin/skills/grasp/extract-structure.mjs';

/** Minimal file descriptor matching the shape produced by scan-project.mjs */
function file(path, language = 'typescript', fileCategory = 'code') {
  return { path, language, fileCategory };
}

describe('nodeTypeForFile', () => {
  it('code -> file', () => {
    expect(nodeTypeForFile(file('src/index.ts', 'typescript', 'code'))).toBe('file');
    expect(nodeTypeForFile(file('src/utils.py', 'python', 'code'))).toBe('file');
    expect(nodeTypeForFile(file('lib/main.go', 'go', 'code'))).toBe('file');
  });

  it('script -> file', () => {
    expect(nodeTypeForFile(file('scripts/build.sh', 'shell', 'script'))).toBe('file');
    expect(nodeTypeForFile(file('scripts/deploy.ps1', 'powershell', 'script'))).toBe('file');
  });

  it('markup -> file', () => {
    expect(nodeTypeForFile(file('src/App.css', 'css', 'markup'))).toBe('file');
    expect(nodeTypeForFile(file('src/Component.html', 'html', 'markup'))).toBe('file');
  });

  it('config -> config', () => {
    expect(nodeTypeForFile(file('package.json', 'json', 'config'))).toBe('config');
    expect(nodeTypeForFile(file('tsconfig.json', 'json', 'config'))).toBe('config');
    expect(nodeTypeForFile(file('pyproject.toml', 'toml', 'config'))).toBe('config');
    expect(nodeTypeForFile(file('.env', 'config', 'config'))).toBe('config');
  });

  it('docs -> document', () => {
    expect(nodeTypeForFile(file('README.md', 'markdown', 'docs'))).toBe('document');
    expect(nodeTypeForFile(file('docs/guide.rst', 'markdown', 'docs'))).toBe('document');
  });

  it('infra: Dockerfile -> service', () => {
    expect(nodeTypeForFile(file('Dockerfile', 'dockerfile', 'infra'))).toBe('service');
    expect(nodeTypeForFile(file('Dockerfile.dev', 'dockerfile', 'infra'))).toBe('service');
    expect(nodeTypeForFile(file('docker-compose.yml', 'yaml', 'infra'))).toBe('service');
  });

  it('infra: .github/workflows -> pipeline', () => {
    expect(nodeTypeForFile(file('.github/workflows/ci.yml', 'yaml', 'infra'))).toBe('pipeline');
    expect(nodeTypeForFile(file('.github/workflows/build.yml', 'yaml', 'infra'))).toBe('pipeline');
  });

  it('infra: Jenkinsfile -> pipeline', () => {
    expect(nodeTypeForFile(file('Jenkinsfile', 'jenkinsfile', 'infra'))).toBe('pipeline');
  });

  it('infra: .tf / .tfvars -> resource', () => {
    expect(nodeTypeForFile(file('main.tf', 'terraform', 'infra'))).toBe('resource');
    expect(nodeTypeForFile(file('vars.tfvars', 'terraform', 'infra'))).toBe('resource');
  });

  it('infra: Makefile -> service (ambiguous default)', () => {
    expect(nodeTypeForFile(file('Makefile', 'makefile', 'infra'))).toBe('service');
  });

  it('data: .sql -> table', () => {
    expect(nodeTypeForFile(file('db/schema.sql', 'sql', 'data'))).toBe('table');
    expect(nodeTypeForFile(file('migrations/001.sql', 'sql', 'data'))).toBe('table');
  });

  it('data: .graphql / .gql -> schema', () => {
    expect(nodeTypeForFile(file('schema.graphql', 'graphql', 'data'))).toBe('schema');
    expect(nodeTypeForFile(file('api/types.gql', 'graphql', 'data'))).toBe('schema');
  });

  it('data: .proto -> schema', () => {
    expect(nodeTypeForFile(file('types.proto', 'protobuf', 'data'))).toBe('schema');
  });

  it('data: .prisma -> schema', () => {
    expect(nodeTypeForFile(file('prisma/schema.prisma', 'prisma', 'data'))).toBe('schema');
  });

  it('data: openapi.yaml -> endpoint (fallback by path)', () => {
    expect(nodeTypeForFile(file('openapi.yaml', 'yaml', 'data'))).toBe('endpoint');
    expect(nodeTypeForFile(file('api/swagger.json', 'json', 'data'))).toBe('endpoint');
  });

  it('data: unrecognised language -> table (fallback)', () => {
    // When language is unrecognised but extension is present, default to table.
    expect(nodeTypeForFile(file('db/data.csv', 'csv', 'data'))).toBe('table');
  });

  it('empty/unknown fileCategory -> file', () => {
    expect(nodeTypeForFile(file('README.md', 'markdown', ''))).toBe('file');
    expect(nodeTypeForFile(file('README.md', 'markdown', 'unknown'))).toBe('file');
  });
});

describe('buildFileNode', () => {
  it('src/index.ts (code) -> {id:"file:src/index.ts", type:"file"}', () => {
    const node = buildFileNode(file('src/index.ts', 'typescript', 'code'));
    expect(node.id).toBe('file:src/index.ts');
    expect(node.type).toBe('file');
    expect(node.name).toBe('index.ts');
    expect(node.filePath).toBe('src/index.ts');
    expect(node.fileCategory).toBe('code');
  });

  it('README.md (docs) -> {id:"document:README.md", type:"document"}', () => {
    const node = buildFileNode(file('README.md', 'markdown', 'docs'));
    expect(node.id).toBe('document:README.md');
    expect(node.type).toBe('document');
    expect(node.name).toBe('README.md');
  });

  it('package.json (config) -> {id:"config:package.json", type:"config"}', () => {
    const node = buildFileNode(file('package.json', 'json', 'config'));
    expect(node.id).toBe('config:package.json');
    expect(node.type).toBe('config');
    expect(node.name).toBe('package.json');
  });

  it('Dockerfile (infra) -> {id:"service:Dockerfile", type:"service"}', () => {
    const node = buildFileNode(file('Dockerfile', 'dockerfile', 'infra'));
    expect(node.id).toBe('service:Dockerfile');
    expect(node.type).toBe('service');
  });

  it('.github/workflows/ci.yml (infra) -> {id:"pipeline:.github/workflows/ci.yml", type:"pipeline"}', () => {
    const node = buildFileNode(file('.github/workflows/ci.yml', 'yaml', 'infra'));
    expect(node.id).toBe('pipeline:.github/workflows/ci.yml');
    expect(node.type).toBe('pipeline');
  });

  it('schema.sql (data) -> {id:"table:schema.sql", type:"table"}', () => {
    const node = buildFileNode(file('schema.sql', 'sql', 'data'));
    expect(node.id).toBe('table:schema.sql');
    expect(node.type).toBe('table');
  });

  it('openapi.yaml (data) -> {id:"endpoint:openapi.yaml", type:"endpoint"}', () => {
    const node = buildFileNode(file('openapi.yaml', 'yaml', 'data'));
    expect(node.id).toBe('endpoint:openapi.yaml');
    expect(node.type).toBe('endpoint');
  });

  it('Makefile (infra) -> service type (ambiguous default)', () => {
    const node = buildFileNode(file('Makefile', 'makefile', 'infra'));
    expect(node.id).toBe('service:Makefile');
    expect(node.type).toBe('service');
  });
});

describe('buildResult', () => {
  it('includes fileNodes array with correct entry for a code file', () => {
    const f = file('src/app.ts', 'typescript', 'code');
    const result = buildResult(f, 50, 40, null, null, {});
    expect(result.fileNodes).toBeDefined();
    expect(result.fileNodes).toHaveLength(1);
    expect(result.fileNodes[0].id).toBe('file:src/app.ts');
    expect(result.fileNodes[0].type).toBe('file');
    expect(result.fileNodes[0].name).toBe('app.ts');
    expect(result.fileNodes[0].filePath).toBe('src/app.ts');
    expect(result.fileNodes[0].fileCategory).toBe('code');
  });

  it('includes fileNodes array for a document file', () => {
    const f = file('README.md', 'markdown', 'docs');
    const result = buildResult(f, 10, 8, null, null, {});
    expect(result.fileNodes).toBeDefined();
    expect(result.fileNodes).toHaveLength(1);
    expect(result.fileNodes[0].id).toBe('document:README.md');
    expect(result.fileNodes[0].type).toBe('document');
  });

  it('includes fileNodes array for an infra service file', () => {
    const f = file('Dockerfile', 'dockerfile', 'infra');
    const result = buildResult(f, 20, 15, null, null, {});
    expect(result.fileNodes[0].id).toBe('service:Dockerfile');
    expect(result.fileNodes[0].type).toBe('service');
  });

  it('includes fileNodes array for an infra pipeline file', () => {
    const f = file('.github/workflows/ci.yml', 'yaml', 'infra');
    const result = buildResult(f, 30, 25, null, null, {});
    expect(result.fileNodes[0].id).toBe('pipeline:.github/workflows/ci.yml');
    expect(result.fileNodes[0].type).toBe('pipeline');
  });

  it('includes fileNodes array for a data table file', () => {
    const f = file('db/schema.sql', 'sql', 'data');
    const result = buildResult(f, 100, 80, null, null, {});
    expect(result.fileNodes[0].id).toBe('table:db/schema.sql');
    expect(result.fileNodes[0].type).toBe('table');
  });

  it('includes fileNodes array for a data endpoint file', () => {
    const f = file('openapi.yaml', 'yaml', 'data');
    const result = buildResult(f, 200, 150, null, null, {});
    expect(result.fileNodes[0].id).toBe('endpoint:openapi.yaml');
    expect(result.fileNodes[0].type).toBe('endpoint');
  });

  it('still populates functions/classes/exports when analysis is present', () => {
    const f = file('src/main.ts', 'typescript', 'code');
    const analysis = {
      functions: [{ name: 'main', lineRange: [1, 10], params: [] }],
      classes: [],
      exports: [],
      imports: [],
    };
    const result = buildResult(f, 10, 8, analysis, null, {});
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe('main');
  });

  it('returns basic metrics when analysis is absent', () => {
    const f = file('README.md', 'markdown', 'docs');
    const result = buildResult(f, 5, 4, null, null, {});
    expect(result.metrics).toEqual({});
    expect(result.fileNodes).toBeDefined();
  });
});
