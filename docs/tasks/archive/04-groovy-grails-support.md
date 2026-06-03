# Task 4: Groovy and Grails Language Support

## Description

Add full Groovy language support and Grails framework detection. The primary target codebase is a Grails application — without this, all `.groovy` files are invisible to the extraction pipeline.

## Actions

### 4.1 G1 — groovy.ts language config

**New file:** `grasp-it-plugin/packages/core/src/languages/configs/groovy.ts`

Create language config for Groovy:
```typescript
import type { LanguageConfig } from "../types.js";

export const groovyConfig = {
  id: "groovy",
  displayName: "Groovy",
  extensions: [".groovy", ".gvy", ".gy", ".gsh"],
  treeSitter: {
    wasmPackage: "tree-sitter-groovy",
    wasmFile: "tree-sitter-groovy.wasm",
  },
  concepts: [
    "closures",
    "dynamic typing",
    "GDK extensions",
    "traits",
    "AST transformations",
    "builders",
    "metaprogramming",
    "GORM",
    "dependency injection",
    "annotations",
  ],
  filePatterns: {
    entryPoints: [
      "grails-app/controllers/**/*Controller.groovy",
      "grails-app/services/**/*Service.groovy",
      "grails-app/jobs/**/*Job.groovy",
    ],
    barrels: [],
    tests: ["*Spec.groovy", "*Test.groovy", "*Tests.groovy", "*IT.groovy"],
    config: ["build.gradle", "grails-app/conf/application.yml",
             "grails-app/conf/application.groovy"],
  },
} satisfies LanguageConfig;
```

**Modify:** `grasp-it-plugin/packages/core/src/languages/configs/index.ts`
- Add import for `groovyConfig`
- Add to `builtinLanguageConfigs` array
- Add to named exports

**Modify:** `grasp-it-plugin/packages/core/package.json`
- Add dependency: `"tree-sitter-groovy": "^0.1.2"` (confirmed installed version — do NOT use `^0.25.0`)

### 4.2 G2 — Groovy import resolver

**File:** `grasp-it-plugin/skills/grasp/extract-import-map.mjs`

- Build a `groovyIndex` suffix index (same pattern as javaIndex)
- Create `resolveGroovyImport` function: probe `.groovy` first via `resolveDottedFqn`, then fall back to `.java` for cross-language imports
- Add `"groovy"` dispatch in `resolveImport` function

### 4.3 G3 — GSP file support

**New file:** `grasp-it-plugin/packages/core/src/languages/configs/gsp.ts`

```typescript
import type { LanguageConfig } from "../types.js";

export const gspConfig = {
  id: "gsp",
  displayName: "Grails Server Pages",
  extensions: [".gsp"],
  concepts: ["server-side rendering", "Grails tag libraries", "controller references"],
  filePatterns: { entryPoints: [], barrels: [], tests: [], config: [] },
} satisfies LanguageConfig;
```

**Modify:** `grasp-it-plugin/packages/core/src/languages/configs/index.ts`
- Add import for `gspConfig` (non-code language)
- Add to `builtinLanguageConfigs` array

**Modify:** `grasp-it-plugin/skills/grasp-domain/extract-domain-context.py`
- Add `.gsp` to `SOURCE_EXTENSIONS` set

### 4.4 G4 — Grails entry point patterns

**File:** `grasp-it-plugin/skills/grasp-domain/extract-domain-context.py`

- Add `.groovy`, `.gvy` to `SOURCE_EXTENSIONS`
- Add Grails/Spring entry point patterns to `ENTRY_POINT_PATTERNS`:
  - Grails controller action methods (`def name(`)
  - Spring/Grails HTTP mapping annotations (`@GetMapping`, `@PostMapping`, etc.)
  - Grails URL mappings DSL (`"/path" {`)
  - Grails job triggers (`static triggers = {`)
  - Grails service transactional methods (`@Transactional` + method)
- Extend `priority_keywords` in `extract_file_signatures` with: `domain`, `taglib`, `interceptor`

### 4.5 G5 — Grails framework config

**New file:** `grasp-it-plugin/packages/core/src/languages/frameworks/grails.ts`

```typescript
import type { FrameworkConfig } from "../types.js";

export const grailsConfig = {
  id: "grails",
  displayName: "Grails",
  languages: ["groovy", "java"],
  detectionKeywords: ["grails", "org.grails", "grails-core", "gorm"],
  manifestFiles: ["build.gradle", "grails-app/conf/application.yml"],
  promptSnippetPath: "./frameworks/grails.md",
  entryPoints: [
    "grails-app/controllers/**/*Controller.groovy",
    "grails-app/init/*Application.groovy",
  ],
  layerHints: {
    controller: "api",
    service: "service",
    domain: "data",
    repository: "data",
    job: "service",
    taglib: "ui",
    interceptor: "middleware",
    conf: "config",
    command: "types",
    dto: "types",
  },
} satisfies FrameworkConfig;
```

**Modify:** `grasp-it-plugin/packages/core/src/languages/frameworks/index.ts`
- Add import for `grailsConfig`
- Add to `builtinFrameworkConfigs` array
- Add to named exports

**Create:** `grasp-it-plugin/packages/core/src/languages/frameworks/grails.md`

The `promptSnippetPath: "./frameworks/grails.md"` in `grailsConfig` references this file — it must be created. It should be a Grails framework context prompt for the LLM, describing Grails conventions: `grails-app/` directory layout (controllers, services, domain classes, jobs, taglibs, interceptors, conf), GORM for persistence, GSP views, URL mappings DSL, and how controller public methods map to HTTP actions. This prompt snippet is injected into the domain-analyzer LLM context when a Grails project is detected.

### 4.6 G6 — Extend Spring framework config for Groovy

**File:** `grasp-it-plugin/packages/core/src/languages/frameworks/spring.ts`

Change line:
```typescript
languages: ["java", "kotlin"],
```
to:
```typescript
languages: ["java", "kotlin", "groovy"],
```

### 4.7 Build verification

After all changes:
```bash
pnpm --filter @grasp-it/core build
pnpm --filter @grasp-it/skill build
```

Confirm builds succeed with no TypeScript errors.

## Completion

When complete:
- All 6 sub-tasks (G1-G6) implemented
- Builds pass
- Commit with message: `feat: add Groovy and Grails language support`
- Push to remote