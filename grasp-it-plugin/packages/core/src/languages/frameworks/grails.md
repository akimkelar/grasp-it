# Grails Framework Context

Grails is a full-stack web framework built on Groovy and Java. It follows
convention-over-configuration to minimize boilerplate.

## Directory Layout (grails-app/)

```
grails-app/
  controllers/     # HTTP request handlers (<< Controller)
                   # Public methods map to HTTP actions by name
  services/       # Business logic, transactional services (<< Service)
                   # Grails services are transactional by default
  domain/         # GORM entity classes (<< Domain)
                   # Map to database tables; support relationships, constraints
  jobs/           # Scheduled background jobs (<< Job)
                   # Uses Quartz under the hood; defined with triggers DSL
  taglib/         # Custom tag libraries for GSP views (<< TagLib)
                   # Expose methods as tags callable in GSP pages
  interceptors/   # Before/after interceptors for requests (<< Interceptor)
                   # before() and after() hooks for cross-cutting concerns
  conf/           # Application configuration (application.yml, application.groovy)
                   # DataSources, URL mappings, plugin settings
  views/          # GSP pages and templates
                   # controller-name/action-name.gsp convention
  init/           # Bootstrap / startup (Application.groovy)
                   # Defines grailsApplication lifecycle hook
```

## Key Patterns

### Controller Actions
Public methods on controllers are HTTP actions by default:
```groovy
class BookController {
    def index() { }          // GET /book/index
    def list() { }           // GET /book/list
    def save() { }           // POST /book/save
}
```

Annotations override default routing:
```groovy
@GetMapping("/books")
def list() { ... }

@PostMapping("/books")
def save() { ... }
```

### URL Mappings DSL
`grails-app/conf/application.groovy`:
```groovy
"/api/books"(resources: "book")
"/authors"(controller: "author", action: "show", method: "GET")
```

### GORM Entities
```groovy
class Book {
    String title
    Author author
    static belongsTo = [author: Author]
    static constraints = {
        title blank: false
    }
}
```

### Service Transactionality
Grails services are transactional by default. Use `@Transactional` explicitly
to control rollback behavior:
```groovy
class BookService {
    @Transactional
    def createBook(Map params) { ... }
}
```

### Job Triggers
```groovy
class MyJob {
    static triggers = {
        cron name: 'midnight', cronExpression: "0 0 0 * * ?"
        simple name: 'every5min', repeatInterval: 300000
    }
    def execute() { ... }
}
```

### Grails Plugins
Installed plugins appear in `build.gradle`:
```groovy
plugins {
    compile "org.grails.plugins:hibernate5"
}
```