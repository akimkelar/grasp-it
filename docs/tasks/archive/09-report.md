# Task 9 Completion Report: Tests for Groovy Import Resolver

## What was done

### 1. Added Groovy resolver tests to `test_extract_import_map.test.mjs`

Added a new `describe('extract-import-map.mjs — Groovy resolver')` block with 4 test cases covering:

- **Basic Groovy dotted import resolution** (9.2): Verifies that `com.example.service.InterviewService` and `com.example.domain.Interview` resolve correctly via suffix probe.
- **Groovy→Java cross-language fallback** (9.3): Verifies that a `.groovy` file importing a `.java` class gets the correct edge when no `.groovy` version exists.
- **External Groovy/Grails imports are dropped** (9.4): Verifies that `grails.gorm.*` and `org.springframework.*` imports produce no edges, while local imports resolve.
- **Grails controller importing service** (9.5): Verifies the canonical Grails architecture pattern resolves correctly.

### 2. Fixed broken import-source extraction for Groovy

**Bug discovered during test implementation**: The Groovy resolver (`resolveGroovyImport`) was implemented in Task 4, but the `extractExtraImportSources` function that feeds imports to the resolver had no Groovy handler. Since `tree-sitter-groovy` is not installed in the project, Groovy files were returning `imports: []` from tree-sitter, and without a fallback regex pass, all Groovy imports were silently dropped.

**Fix applied to `extract-import-map.mjs`**:
- Added `GROOVY_IMPORT_RE` regex (identical pattern to Kotlin's `KOTLIN_IMPORT_RE`)
- Added `extractGroovySources(content)` function
- Added `groovy` case to `extractExtraImportSources()`

### 3. Updated `language-registry.test.ts` (section 9.6)

- Changed `expect(all.length).toBe(40)` to `expect(all.length).toBe(42)` (added groovyConfig and gspConfig in Task 4)
- Added extension assertions: `.groovy`, `.gvy`, `.gsp`
- Added `getForFile` test for `grails-app/controllers/MyController.groovy`

### 4. Fixed test path reference bug

- Changed `../../../grasp-it-plugin/skills/understand/extract-import-map.mjs` to `../../../grasp-it-plugin/skills/grasp/extract-import-map.mjs` in `test_extract_import_map.test.mjs` (the skills were renamed from `understand` to `grasp` but the test path wasn't updated)

## Test Results

All 4 Groovy resolver tests pass:
```
✓ extract-import-map.mjs — Groovy resolver > resolves groovy dotted imports via suffix probe
✓ extract-import-map.mjs — Groovy resolver > falls back to .java when groovy import has no matching .groovy file
✓ extract-import-map.mjs — Groovy resolver > drops external groovy and grails imports
✓ extract-import-map.mjs — Groovy resolver > resolves grails controller importing a service
```

The `language-registry.test.ts` tests also pass with the updated count (42) and new extension assertions.

## Files Modified

- `tests/skill/grasp/test_extract_import_map.test.mjs` — Added Groovy resolver tests, fixed script path
- `grasp-it-plugin/packages/core/src/__tests__/language-registry.test.ts` — Updated count and added assertions
- `grasp-it-plugin/skills/grasp/extract-import-map.mjs` — Added Groovy import-source extraction (bug fix found during testing)