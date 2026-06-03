# Task 12: Write grails.md Framework Prompt Content

## Description

Task 4 (step 4.5, G5) creates `grasp-it-plugin/packages/core/src/languages/frameworks/grails.ts`
which includes `promptSnippetPath: "./frameworks/grails.md"`. This `.md` file must be created
alongside the TypeScript config — it is injected into the LLM's context when a Grails project
is detected, and without it the framework detection is wired up but the LLM gets no
Grails-specific guidance.

Task 4 notes that the file "must be created" but does not specify its content beyond a brief
description. This task focuses solely on writing the content of that prompt file.

## Pre-requisites

- Task 4 step 4.5 (G5) must have created the `grails.ts` framework config file — the
  `promptSnippetPath` reference must already exist before this file is written

## Why this matters

The `promptSnippetPath` is used by the domain-analyzer LLM agent. When Grails is detected, the
prompt snippet is injected as framework context. Without this file:
- The framework detection machinery will look for a file that doesn't exist
- The LLM will receive no Grails-specific guidance, falling back to generic analysis
- The domain-analyzer will likely misclassify Grails layer conventions (controllers as classes,
  services as utilities, GORM domain classes as entities without the correct context)

Other framework prompts exist as reference — see:
`grasp-it-plugin/skills/grasp/frameworks/spring.md`

## Actions

### 12.1 Create the Grails framework prompt file

**New file:** `grasp-it-plugin/packages/core/src/languages/frameworks/grails.md`

The file should cover:

**1. Directory Layout**

Describe the `grails-app/` subdirectory structure and what each directory contains:
- `grails-app/controllers/` — HTTP request handlers. Public action methods map to URL
  endpoints. Naming convention: `*Controller`.
- `grails-app/services/` — Business logic layer, typically `@Transactional`. Naming: `*Service`.
- `grails-app/domain/` — GORM persistent domain classes. These define the data model and
  database schema. Naming: matches the entity name (e.g. `Interview`, `Invoice`).
- `grails-app/jobs/` — Scheduled background tasks using the Quartz scheduler. Naming: `*Job`.
- `grails-app/taglib/` — Grails tag libraries for GSP views. Naming: `*TagLib`.
- `grails-app/views/` — GSP (Groovy Server Pages) view templates, organized by controller
  name.
- `grails-app/conf/` — Configuration files: `application.yml` / `application.groovy`,
  `UrlMappings.groovy`, `DataSource.groovy`.
- `grails-app/init/` — Application bootstrap and initialization classes.
- `src/main/groovy/` — Non-Grails Groovy classes (utilities, DTOs, helpers).
- `src/main/java/` — Java classes used alongside Groovy.
- `src/test/groovy/` — Spock or JUnit tests.

**2. GORM (Grails Object Relational Mapping)**

- Domain classes in `grails-app/domain/` automatically get CRUD methods (`save()`, `delete()`,
  `find*()`, `list()`).
- Relationships are declared as class-level properties: `hasMany`, `belongsTo`, `hasOne`.
- Static `constraints {}` block defines validation rules.
- Static `mapping {}` block configures database mapping.
- Dynamic finders like `Interview.findByStatus("active")` are auto-generated.

**3. URL Mapping DSL**

- `grails-app/conf/UrlMappings.groovy` maps URL patterns to controller actions using a DSL:
  ```groovy
  "/interviews"(controller: "interview", action: "index")
  "/interviews/$id"(controller: "interview", action: "show")
  ```
- Controllers without explicit URL mappings follow the convention:
  `/controllerName/actionName`

**4. Controller Action Methods**

- Public methods in `*Controller.groovy` are HTTP action methods.
- Parameters are bound from request automatically.
- `render`, `redirect`, `respond` are the primary response methods.
- `params` map contains request parameters; `request` and `response` are also available.

**5. Service Layer Conventions**

- Services are Spring beans injected by name into controllers and other services.
- `@Transactional` at class or method level manages database transactions.
- Services are the correct place for business logic — controllers should delegate to services.

**6. Layer Mapping**

For domain analysis, use these layer assignments:
- `controllers/` → `api` layer
- `services/` → `service` layer
- `domain/` → `data` layer
- `jobs/` → `service` layer (background)
- `taglib/` → `ui` layer
- `interceptors/` → `middleware` layer
- `conf/` → `config` layer
- `init/` → `config` layer
- Command objects, DTOs → `types` layer

### 12.2 Verify the framework prompt is wired

After creating the file, confirm that the `promptSnippetPath` in `grails.ts` resolves to
the correct relative path. The path `"./frameworks/grails.md"` is relative to the
`frameworks/` directory — confirm the file lands at:
`grasp-it-plugin/packages/core/src/languages/frameworks/grails.md`

### 12.3 Check if other framework prompts need a grails.md companion

Check whether the `grasp/skills/grasp/frameworks/` directory should also have a `grails.md`
for the project-scanner skill (parallel to `spring.md` in that directory):

```bash
ls grasp-it-plugin/skills/grasp/frameworks/
```

If `spring.md` exists there, create a corresponding `grasp-it-plugin/skills/grasp/frameworks/grails.md`
with the same content as the core prompt (or a lighter version — the skills framework prompts
tend to be shorter summaries).

## Completion

When complete:
- `grasp-it-plugin/packages/core/src/languages/frameworks/grails.md` exists and contains
  the full Grails framework context description
- All six sections (directory layout, GORM, URL mappings, controllers, services, layer
  mapping) are covered
- `promptSnippetPath` in `grails.ts` resolves to the file without error during build
- Commit with message: `docs: add Grails framework prompt content for LLM domain analysis`
