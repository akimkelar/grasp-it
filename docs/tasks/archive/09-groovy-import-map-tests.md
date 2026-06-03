# Task 9: Tests for Groovy Import Resolver

## Description

Task 4 adds a Groovy import resolver (`resolveGroovyImport`) to
`extract-import-map.mjs`. Every other language resolver in the project is covered by
integration tests in `tests/skill/grasp/test_extract_import_map.test.mjs`. The Groovy
resolver must follow the same pattern.

## Pre-requisites

- Task 4 (Groovy and Grails language support) must be complete — the resolver must exist
  before tests can be written for it

## Why this matters

`test_extract_import_map.test.mjs` is an integration test that spawns the actual script and
exercises real Groovy files. Without these tests:
- The Groovy resolver could silently produce zero import edges with no test failure
- Cross-language Groovy→Java fallback behavior is unverified
- Regression protection is absent for one of the project's primary target languages

The Java resolver tests (`extract-import-map.mjs — Java resolver` describe block) are the
direct model to follow.

## Actions

### 9.1 Add Groovy resolver describe block

**File:** `tests/skill/grasp/test_extract_import_map.test.mjs`

Add a new describe block after the Java resolver tests:

```javascript
describe('extract-import-map.mjs — Groovy resolver', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });
```

### 9.2 Test: basic Groovy dotted import resolution

```javascript
it('resolves groovy dotted imports via suffix probe', () => {
  projectRoot = setupTree({
    'src/main/groovy/com/example/InterviewController.groovy':
      `package com.example\n\nimport com.example.service.InterviewService\n` +
      `import com.example.domain.Interview\n\nclass InterviewController { }\n`,
    'src/main/groovy/com/example/service/InterviewService.groovy':
      `package com.example.service\n\nclass InterviewService { }\n`,
    'src/main/groovy/com/example/domain/Interview.groovy':
      `package com.example.domain\n\nclass Interview { }\n`,
  });

  const result = runScript(projectRoot, {
    projectRoot,
    files: [
      { path: 'src/main/groovy/com/example/InterviewController.groovy',
        language: 'groovy', fileCategory: 'code' },
      { path: 'src/main/groovy/com/example/service/InterviewService.groovy',
        language: 'groovy', fileCategory: 'code' },
      { path: 'src/main/groovy/com/example/domain/Interview.groovy',
        language: 'groovy', fileCategory: 'code' },
    ],
  });

  expect(result.status).toBe(0);
  expect(result.output.importMap[
    'src/main/groovy/com/example/InterviewController.groovy'
  ]).toEqual([
    'src/main/groovy/com/example/domain/Interview.groovy',
    'src/main/groovy/com/example/service/InterviewService.groovy',
  ]);
});
```

### 9.3 Test: Groovy→Java cross-language fallback

Groovy files in a Grails project often import Java classes from the same project. The
resolver must probe `.groovy` first, then fall back to `.java`.

```javascript
it('falls back to .java when groovy import has no matching .groovy file', () => {
  projectRoot = setupTree({
    'src/main/groovy/com/example/OfferController.groovy':
      `package com.example\n\nimport com.example.util.JavaHelper\n\nclass OfferController { }\n`,
    // JavaHelper exists only as a .java file, not .groovy
    'src/main/java/com/example/util/JavaHelper.java':
      `package com.example.util;\npublic class JavaHelper { }\n`,
  });

  const result = runScript(projectRoot, {
    projectRoot,
    files: [
      { path: 'src/main/groovy/com/example/OfferController.groovy',
        language: 'groovy', fileCategory: 'code' },
      { path: 'src/main/java/com/example/util/JavaHelper.java',
        language: 'java', fileCategory: 'code' },
    ],
  });

  expect(result.status).toBe(0);
  expect(result.output.importMap[
    'src/main/groovy/com/example/OfferController.groovy'
  ]).toEqual([
    'src/main/java/com/example/util/JavaHelper.java',
  ]);
});
```

### 9.4 Test: drops external Groovy/Grails imports

```javascript
it('drops external groovy and grails imports', () => {
  projectRoot = setupTree({
    'src/main/groovy/com/example/MyService.groovy':
      `package com.example\n\n` +
      `import grails.gorm.transactions.Transactional\n` +
      `import org.springframework.beans.factory.annotation.Autowired\n` +
      `import com.example.domain.LocalDomain\n\n` +
      `class MyService { }\n`,
    'src/main/groovy/com/example/domain/LocalDomain.groovy':
      `package com.example.domain\nclass LocalDomain { }\n`,
  });

  const result = runScript(projectRoot, {
    projectRoot,
    files: [
      { path: 'src/main/groovy/com/example/MyService.groovy',
        language: 'groovy', fileCategory: 'code' },
      { path: 'src/main/groovy/com/example/domain/LocalDomain.groovy',
        language: 'groovy', fileCategory: 'code' },
    ],
  });

  expect(result.status).toBe(0);
  // grails.gorm and org.springframework are external; only LocalDomain resolves.
  expect(result.output.importMap[
    'src/main/groovy/com/example/MyService.groovy'
  ]).toEqual([
    'src/main/groovy/com/example/domain/LocalDomain.groovy',
  ]);
});
```

### 9.5 Test: Grails controller imports service (typical pattern)

This is the canonical Grails architecture test — verifying that the most common real-world
import pattern resolves correctly.

```javascript
it('resolves grails controller importing a service', () => {
  projectRoot = setupTree({
    'grails-app/controllers/com/example/InterviewController.groovy':
      `package com.example\n\nimport com.example.InterviewService\n\n` +
      `class InterviewController {\n    InterviewService interviewService\n}\n`,
    'grails-app/services/com/example/InterviewService.groovy':
      `package com.example\n\nclass InterviewService { }\n`,
  });

  const result = runScript(projectRoot, {
    projectRoot,
    files: [
      { path: 'grails-app/controllers/com/example/InterviewController.groovy',
        language: 'groovy', fileCategory: 'code' },
      { path: 'grails-app/services/com/example/InterviewService.groovy',
        language: 'groovy', fileCategory: 'code' },
    ],
  });

  expect(result.status).toBe(0);
  expect(result.output.importMap[
    'grails-app/controllers/com/example/InterviewController.groovy'
  ]).toEqual([
    'grails-app/services/com/example/InterviewService.groovy',
  ]);
});
```

### 9.6 Add Groovy language config test coverage

**File:** `grasp-it-plugin/packages/core/src/__tests__/language-registry.test.ts`

The `createDefault` describe block has a hardcoded `expect(all.length).toBe(40)` check.
After Task 4 adds `groovyConfig` and `gspConfig`, this number must be updated to `42`.

Also add explicit extension assertions:

```typescript
expect(registry.getByExtension(".groovy")?.id).toBe("groovy");
expect(registry.getByExtension(".gvy")?.id).toBe("groovy");
expect(registry.getByExtension(".gsp")?.id).toBe("gsp");
```

And add a `getForFile` test:
```typescript
expect(registry.getForFile("grails-app/controllers/MyController.groovy")?.id).toBe("groovy");
```

## Completion

When complete:
- `test_extract_import_map.test.mjs` has a Groovy resolver describe block with all 4 test cases
- `language-registry.test.ts` count is updated and Groovy/GSP extensions are asserted
- All tests pass: `pnpm test`
- Commit with message: `test: add Groovy import resolver tests and language registry coverage`
