# Grails Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when Grails is detected.
> Do NOT use as a standalone prompt — always appended to the base prompt template.

## Grails Project Structure

When analyzing a Grails project, apply these additional conventions on top of the base analysis rules.

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `grails-app/controllers/*Controller.groovy` | HTTP request handlers — public methods map to URL endpoints | `api-handler` |
| `grails-app/services/*Service.groovy` | Business logic layer — transactional by default | `service` |
| `grails-app/domain/*.groovy` | GORM persistent entities — map to database tables | `data-model` |
| `grails-app/jobs/*Job.groovy` | Scheduled background tasks using Quartz | `service` |
| `grails-app/taglib/*TagLib.groovy` | Custom tag libraries for GSP views | `ui` |
| `grails-app/interceptors/*Interceptor.groovy` | Request interceptors — before/after hooks | `middleware` |
| `grails-app/conf/UrlMappings.groovy` | URL routing DSL — maps patterns to controller actions | `config` |
| `grails-app/conf/application.yml` | Application configuration — datasource, profiles | `config` |
| `grails-app/init/*Application.groovy` | Application bootstrap — lifecycle hooks | `config` |
| `src/main/groovy/**/*.groovy` | Non-Grails utility classes, DTOs, helpers | `type-definition` |
| `src/test/groovy/**/*Spec.groovy` | Spock unit tests | `test` |

### Edge Patterns to Look For

**Controller-to-service** — When a controller injected a service by name (`def bookService`), create `depends_on` edges from the controller to the service.

**GORM relationships** — When domain classes declare `belongsTo`, `hasMany`, or `hasOne`, create `depends_on` edges between entity classes with the relationship type and ownership direction.

**Service transactionality** — Grails services are transactional by default; `depends_on` edges trace the service layer boundary.

**URL mapping chain** — When `UrlMappings.groovy` maps a URL to a controller action, create `configures` edges from the mappings file to the controller.

### Architectural Layers for Grails

Assign nodes to these layers when detected:

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | `grails-app/controllers/` — HTTP handlers, REST endpoints |
| `layer:service` | Service Layer | `grails-app/services/` — business logic; `grails-app/jobs/` — background jobs |
| `layer:data` | Data Layer | `grails-app/domain/` — GORM entities, database schema |
| `layer:types` | Types Layer | `src/main/groovy/` — command objects, DTOs, value objects |
| `layer:config` | Config Layer | `grails-app/conf/` — UrlMappings, DataSource, application.yml |
| `layer:middleware` | Middleware Layer | `grails-app/interceptors/` — before/after request hooks |
| `layer:ui` | UI Layer | `grails-app/taglib/` — custom tag libraries; `grails-app/views/` — GSP templates |
| `layer:test` | Test Layer | `src/test/groovy/` — Spock and JUnit tests |

### Notable Patterns to Capture in languageLesson

- **Convention over configuration**: Grails derives URL routes, service injection names, and file locations from class names — `BookController` maps to `/book`, with actions as URL segments
- **GORM persistence by convention**: Domain classes in `grails-app/domain/` automatically get CRUD methods (`save()`, `delete()`, `find*()`, `list()`); no DAO layer needed
- **Service transactionality**: Services are transactional by default — use `@Transactional` to control rollback behavior explicitly
- **Static constraints block**: Domain classes declare validation rules in a static `constraints {}` block — these drive both validation and database mapping
- **Quartz job scheduling**: Jobs are defined with a triggers DSL in the job class itself — cron expressions or fixed intervals schedule background work
