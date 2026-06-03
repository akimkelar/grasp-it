# Task 4 Report: Groovy and Grails Language Support

## Summary

Added full Groovy language support and Grails framework detection as specified in task G1-G6.

## Changes Made

### G1 — groovy.ts language config
- **New file:** `grasp-it-plugin/packages/core/src/languages/configs/groovy.ts`
  - Language config for Groovy with `.groovy`, `.gvy`, `.gy`, `.gsh` extensions
  - tree-sitter WASM package: `tree-sitter-groovy`
  - Grails entry point patterns for controllers, services, and jobs
  - Config file patterns for `build.gradle`, `application.yml`, `application.groovy`
- **Modified:** `grasp-it-plugin/packages/core/src/languages/configs/index.ts`
  - Added `groovyConfig` import and exports (both code languages array and named export)
- **Modified:** `grasp-it-plugin/packages/core/package.json`
  - Added `"tree-sitter-groovy": "^0.1.2"` dependency

### G2 — Groovy import resolver
- **Modified:** `grasp-it-plugin/skills/grasp/extract-import-map.mjs`
  - Added `groovyIndex` suffix index in `buildResolutionContext()`
  - Added `resolveGroovyImport()` function that probes `.groovy` first, falls back to `.java`
  - Added `"groovy"` dispatch case in `resolveImport()`

### G3 — GSP file support
- **New file:** `grasp-it-plugin/packages/core/src/languages/configs/gsp.ts`
  - Language config for Grails Server Pages (`.gsp` extension)
- **Modified:** `grasp-it-plugin/packages/core/src/languages/configs/index.ts`
  - Added `gspConfig` import and exports (non-code language)
- **Modified:** `grasp-it-plugin/skills/grasp-domain/extract-domain-context.py`
  - Added `.gsp` to `SOURCE_EXTENSIONS`

### G4 — Grails entry point patterns
- **Modified:** `grasp-it-plugin/skills/grasp-domain/extract-domain-context.py`
  - Added `.groovy`, `.gvy`, `.gy`, `.gsh` to `SOURCE_EXTENSIONS`
  - Added Grails controller action pattern: `def name(`
  - Added Spring/Grails HTTP mapping annotations: `@GetMapping`, `@PostMapping`, etc.
  - Added Grails URL mappings DSL pattern: `"/path" {`
  - Added Grails job triggers pattern: `static triggers = {`
  - Added Grails transactional method pattern: `@Transactional`
  - Extended `priority_keywords` with `domain`, `taglib`

### G5 — Grails framework config
- **New file:** `grasp-it-plugin/packages/core/src/languages/frameworks/grails.ts`
  - Framework config with `grails-app/` entry points, layer hints, detection keywords
- **Modified:** `grasp-it-plugin/packages/core/src/languages/frameworks/index.ts`
  - Added `grailsConfig` import and exports
- **New file:** `grasp-it-plugin/packages/core/src/languages/frameworks/grails.md`
  - LLM context prompt describing Grails conventions: directory layout, GORM, URL mappings, controller actions, service transactionality, job triggers

### G6 — Extend Spring framework config for Groovy
- **Modified:** `grasp-it-plugin/packages/core/src/languages/frameworks/spring.ts`
  - Changed `languages: ["java", "kotlin"]` to `languages: ["java", "kotlin", "groovy"]`

## Verification

- `pnpm --filter @grasp-it/core build` — passed with no TypeScript errors
- `pnpm --filter @grasp-it/skill build` — passed with no TypeScript errors

## Sub-tasks Completed

| Sub-task | Description | Status |
|----------|-------------|--------|
| G1 | groovy.ts language config | Done |
| G2 | Groovy import resolver | Done |
| G3 | GSP file support | Done |
| G4 | Grails entry point patterns | Done |
| G5 | Grails framework config | Done |
| G6 | Extend Spring for Groovy | Done |