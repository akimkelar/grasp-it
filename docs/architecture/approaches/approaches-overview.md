# Knowledge Graph Approaches

## Purpose

This note summarizes the investigation into how Neo4j knowledge graphs for web-development projects are typically built and which schema styles are most effective for describing a project that includes both business rules and codebase knowledge.

The focus is on approaches that help answer questions such as:

- what the project does at a business level
- which features belong to which domains
- which rules constrain those features
- where those rules are implemented in code
- which code, APIs, data stores, and documents are affected by a change

## Short conclusion

The most effective approach for a web-development project is usually not a pure code graph and not a pure documentation graph.

The strongest pattern is a hybrid graph with:

- a business/domain subgraph centered on `Domain`, `Feature`, `UseCase`, and `BusinessRule`
- a code subgraph centered on modules, files, classes, methods, APIs, and data artifacts
- a document or lexical subgraph that preserves provenance from docs, tickets, ADRs, and specs

The bridge between the business and technical views is usually the `Feature` node, sometimes supported by `UseCase`, `API`, and `Entity`.

## Typical build approaches

## Approach 1: business-first domain graph

This approach models the project primarily in terms of product meaning and system behavior. It is strongest when the main goal is understanding what the system does and why.

Typical inputs:

- domain documentation
- product specs
- Jira and Confluence content
- ADRs
- concept plans or curated summaries

Typical core nodes:

- `Domain`
- `Subdomain`
- `Feature`
- `UseCase`
- `BusinessRule`
- `Entity`
- `ValueObject`
- `Event`

Why teams use it:

- it matches how product and engineering usually talk about the system
- it makes rules and scope clearer than a code-only model
- it gives AI and engineers a stable conceptual layer above implementation details

Tradeoffs:

- weaker for precise impact analysis unless connected to code artifacts
- requires curation to avoid fuzzy or duplicated business concepts

```mermaid
flowchart TD
    classDef domain fill:#7068CC,stroke:#DDD6FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef feature fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef rule fill:#3CA0B0,stroke:#99F6E4,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef concept fill:#4A94BF,stroke:#BAE6FD,stroke-width:2px,color:#F8FAFC,font-size:16px;

    D(( Domain ))
    S(( Subdomain ))
    F(( Feature ))
    U(( UseCase ))
    R(( BusinessRule ))
    E(( Entity ))
    V(( ValueObject ))
    EV(( Event ))

    D --> S
    S --> F
    F --> U
    U --> R
    F --> E
    E --> V
    U --> EV

    linkStyle default stroke:#6B7280,stroke-width:1px;

    class D,S domain;
    class F,U feature;
    class R rule;
    class E,V,EV concept;
    style D width:120px,height:120px;
    style S width:120px,height:120px;
    style F width:120px,height:120px;
    style U width:120px,height:120px;
    style R width:120px,height:120px;
    style E width:120px,height:120px;
    style V width:120px,height:120px;
    style EV width:120px,height:120px;
```

## Approach 2: code-first architecture graph

This approach starts from static structure and runtime-adjacent structure in the codebase. It is strongest when the main goal is dependency analysis, refactoring support, and implementation tracing.

Typical inputs:

- source code parsing
- build metadata
- dependency manifests
- API specs
- database schemas
- config files

Typical core nodes:

- `Repository`
- `Module`
- `Package`
- `Folder`
- `File`
- `Class`
- `Interface`
- `Method`
- `Endpoint`
- `DatabaseTable`
- `Queue`
- `ConfigFile`

Why teams use it:

- it is deterministic and easier to generate automatically
- it is excellent for dependency and impact queries
- it resembles common code-graph and code property graph patterns

Tradeoffs:

- it does not describe product intent well on its own
- it can become noisy if all low-level code detail is loaded without abstraction

```mermaid
flowchart TD
    classDef container fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef code fill:#4A94BF,stroke:#BAE6FD,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef infra fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;

    R(( Repository ))
    M(( Module ))
    P(( Package ))
    FD(( Folder ))
    FL(( File ))
    C(( Class ))
    I(( Interface ))
    MT(( Method ))
    EP(( Endpoint ))
    DB(( DatabaseTable ))
    Q(( Queue ))
    CFG(( ConfigFile ))

    R --> M
    M --> P
    P --> FD
    FD --> FL
    FL --> C
    FL --> I
    C --> MT
    I --> MT
    EP --> MT
    MT --> DB
    MT --> Q
    M --> CFG

    class R,M,P,FD,FL container;
    class C,I,MT,EP code;
    class DB,Q,CFG infra;
    style R width:120px,height:120px;
    style M width:120px,height:120px;
    style P width:120px,height:120px;
    style FD width:120px,height:120px;
    style FL width:120px,height:120px;
    style C width:120px,height:120px;
    style I width:120px,height:120px;
    style MT width:120px,height:120px;
    style EP width:120px,height:120px;
    style DB width:120px,height:120px;
    style Q width:120px,height:120px;
    style CFG width:120px,height:120px;
```

## Approach 3: document-grounded hybrid graph

This approach preserves source-document structure and extracts domain entities from it. It is strongest for AI retrieval, onboarding, and explaining why the system behaves in a certain way.

Typical inputs:

- wiki pages
- design docs
- tickets
- ADRs
- support notes
- code comments

Typical core nodes:

- `Document`
- `Chunk`
- `Domain`
- `Feature`
- `BusinessRule`
- `API`
- `Entity`
- `Decision`
- `Owner`

Why teams use it:

- it preserves provenance
- it supports question answering and traceable summaries
- it matches current Neo4j guidance around lexical and domain subgraphs

Tradeoffs:

- extracted entities need strong deduplication and normalization
- document-heavy graphs can become vague without a curated domain backbone

```mermaid
flowchart TD
    classDef doc fill:#1F2937,stroke:#6B7280,stroke-width:2px,color:#E5E7EB,font-size:16px;
    classDef business fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef rule fill:#3CA0B0,stroke:#99F6E4,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef meta fill:#4A94BF,stroke:#BAE6FD,stroke-width:2px,color:#F8FAFC,font-size:16px;

    DOC(( Document ))
    CH(( Chunk ))
    D(( Domain ))
    F(( Feature ))
    R(( BusinessRule ))
    API(( API ))
    E(( Entity ))
    DS(( Decision ))
    O(( Owner ))

    DOC --> CH
    CH --> D
    CH --> F
    CH --> R
    CH --> API
    CH --> E
    CH --> DS
    DS --> F
    O --> DOC

    linkStyle default stroke:#6B7280,stroke-width:1px;

    class DOC,CH doc;
    class D,F,API business;
    class R rule;
    class E,DS,O meta;
    style DOC width:120px,height:120px;
    style CH width:120px,height:120px;
    style D width:120px,height:120px;
    style F width:120px,height:120px;
    style R width:120px,height:120px;
    style API width:120px,height:120px;
    style E width:120px,height:120px;
    style DS width:120px,height:120px;
    style O width:120px,height:120px;
```

## Approach 4: rule-centric governance graph

This approach treats business rules, policies, constraints, and exceptions as first-class nodes. It is strongest when the project has complex validation, permissions, compliance, pricing, or workflow restrictions.

Typical inputs:

- backend validation code
- policy documentation
- specs
- tests
- customer-specific constraints

Typical core nodes:

- `Policy`
- `BusinessRule`
- `Constraint`
- `Exception`
- `Feature`
- `UseCase`
- `Field`
- `Validator`
- `TestCase`
- `Tenant`

Why teams use it:

- it makes hidden constraints explicit
- it helps find where a rule is enforced and how it is tested
- it is useful for migration and parity work

Tradeoffs:

- can feel abstract unless attached to features and code
- may over-fragment if every small validation becomes a separate node

```mermaid
flowchart TD
    classDef policy fill:#A45FA8,stroke:#F5D0FE,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef feature fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef enforcement fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef scope fill:#4A94BF,stroke:#BAE6FD,stroke-width:2px,color:#F8FAFC,font-size:16px;

    P(( Policy ))
    R(( BusinessRule ))
    C(( Constraint ))
    EX(( Exception ))
    F(( Feature ))
    U(( UseCase ))
    FLD(( Field ))
    V(( Validator ))
    T(( TestCase ))
    TN(( Tenant ))

    P --> R
    R --> C
    R --> EX
    R --> F
    F --> U
    C --> FLD
    R --> V
    R --> T
    R --> TN

    linkStyle default stroke:#6B7280,stroke-width:1px;

    class P,R,C,EX policy;
    class F,U feature;
    class V,T enforcement;
    class FLD,TN scope;
    style P width:120px,height:120px;
    style R width:120px,height:120px;
    style C width:120px,height:120px;
    style EX width:120px,height:120px;
    style F width:120px,height:120px;
    style U width:120px,height:120px;
    style FLD width:120px,height:120px;
    style V width:120px,height:120px;
    style T width:120px,height:120px;
    style TN width:120px,height:120px;
```

## Recommended schemas

Below are several practical schema styles that are good candidates for a project knowledge graph.

## Schema A: DDD and feature traceability

This is the best default schema when the goal is to describe the project in a way that is useful for both humans and AI systems.

Core nodes:

- `Domain`
- `Subdomain`
- `Feature`
- `UseCase`
- `BusinessRule`
- `Entity`
- `API`
- `UIPage`
- `Service`
- `Repository`
- `Table`
- `ExternalSystem`

Typical relationships:

- `HAS_SUBDOMAIN`
- `OWNS_FEATURE`
- `IMPLEMENTS_USE_CASE`
- `CONSTRAINED_BY`
- `USES_ENTITY`
- `EXPOSED_BY`
- `TRIGGERS`
- `REALIZED_BY`
- `READS`
- `WRITES`
- `CALLS_EXTERNAL`

Why it is good:

- very balanced between business meaning and implementation traceability
- `Feature` becomes a natural anchor for navigation
- supports common change-analysis and onboarding questions well

```mermaid
flowchart TD
    classDef domain fill:#7068CC,stroke:#DDD6FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef feature fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef rule fill:#3CA0B0,stroke:#99F6E4,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef impl fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;

    D(( Domain ))
    S(( Subdomain ))
    F(( Feature ))
    U(( UseCase ))
    R(( BusinessRule ))
    E(( Entity ))
    A(( API ))
    UI(( UIPage ))
    SV(( Service ))
    T(( Table ))
    X(( ExternalSystem ))

    D -->|HAS_SUBDOMAIN| S
    S -->|OWNS_FEATURE| F
    F -->|IMPLEMENTS_USE_CASE| U
    U -->|CONSTRAINED_BY| R
    F -->|USES_ENTITY| E
    F -->|EXPOSED_BY| A
    UI -->|TRIGGERS| U
    F -->|REALIZED_BY| SV
    SV -->|READS| T
    SV -->|WRITES| T
    SV -->|CALLS_EXTERNAL| X

    linkStyle 0,1,2,3,4,5,6,7 stroke:#6B7280,stroke-width:1px;
    linkStyle 8,9 stroke:#7C8AA5,stroke-width:1px;
    linkStyle 10 stroke:#6B7280,stroke-width:1px;

    class D,S domain;
    class F,U,A,UI feature;
    class R rule;
    class E,SV,T,X impl;
    style D width:120px,height:120px;
    style S width:120px,height:120px;
    style F width:120px,height:120px;
    style U width:120px,height:120px;
    style R width:120px,height:120px;
    style E width:120px,height:120px;
    style A width:120px,height:120px;
    style UI width:120px,height:120px;
    style SV width:120px,height:120px;
    style T width:120px,height:120px;
    style X width:120px,height:120px;
```

## Schema B: code and dependency graph

This is the best schema when the graph is mainly for engineering analysis, refactoring, dependency tracking, and architecture governance.

Core nodes:

- `Repository`
- `Module`
- `Package`
- `Folder`
- `File`
- `Class`
- `Interface`
- `Method`
- `Endpoint`
- `DatabaseTable`
- `Library`
- `ConfigFile`

Typical relationships:

- `CONTAINS`
- `DEPENDS_ON`
- `DECLARES`
- `IMPLEMENTS`
- `CALLS`
- `INSTANTIATES`
- `EXPOSES`
- `READS`
- `WRITES`
- `CONFIGURES`

Why it is good:

- highly automatable
- very strong for precise impact analysis
- aligns well with known code-graph patterns

```mermaid
flowchart TD
    classDef container fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef code fill:#4A94BF,stroke:#BAE6FD,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef infra fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;

    R(( Repository ))
    M(( Module ))
    P(( Package ))
    FD(( Folder ))
    FL(( File ))
    C(( Class ))
    I(( Interface ))
    MT(( Method ))
    EP(( Endpoint ))
    DB(( DatabaseTable ))
    L(( Library ))
    CFG(( ConfigFile ))

    R -->|CONTAINS| M
    M -->|CONTAINS| P
    P -->|CONTAINS| FD
    FD -->|CONTAINS| FL
    FL -->|DECLARES| C
    FL -->|DECLARES| I
    C -->|IMPLEMENTS| I
    C -->|CONTAINS| MT
    EP -->|EXPOSES| MT
    MT -->|CALLS| MT
    MT -->|READS| DB
    MT -->|WRITES| DB
    M -->|DEPENDS_ON| L
    M -->|CONFIGURES| CFG

    linkStyle 0,1,2,3,4,5,6,7,8,13 stroke:#6B7280,stroke-width:1px;
    linkStyle 9 stroke:#4A94BF,stroke-width:1px;
    linkStyle 10,11 stroke:#7C8AA5,stroke-width:1px;
    linkStyle 12 stroke:#6B7280,stroke-width:1.5px;

    class R,M,P,FD,FL container;
    class C,I,MT,EP code;
    class DB,L,CFG infra;
    style R width:120px,height:120px;
    style M width:120px,height:120px;
    style P width:120px,height:120px;
    style FD width:120px,height:120px;
    style FL width:120px,height:120px;
    style C width:120px,height:120px;
    style I width:120px,height:120px;
    style MT width:120px,height:120px;
    style EP width:120px,height:120px;
    style DB width:120px,height:120px;
    style L width:120px,height:120px;
    style CFG width:120px,height:120px;
```

## Schema C: lexical and domain hybrid

This is the best schema when the graph must preserve document evidence and support AI retrieval, but still remain structured enough for engineering use.

Core nodes:

- `Document`
- `Chunk`
- `Domain`
- `Feature`
- `UseCase`
- `BusinessRule`
- `Entity`
- `API`
- `Class`
- `Method`
- `Decision`

Typical relationships:

- `HAS_CHUNK`
- `NEXT_CHUNK`
- `MENTIONS`
- `EXPLAINS`
- `AFFECTS`
- `IMPLEMENTED_BY`
- `ENFORCED_BY`
- `DOCUMENTED_IN`

Why it is good:

- strongest provenance and explainability
- strong fit for GraphRAG and project Q and A
- makes it easier to ground graph facts in source material

```mermaid
flowchart TD
    classDef doc fill:#1F2937,stroke:#6B7280,stroke-width:2px,color:#E5E7EB,font-size:16px;
    classDef business fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef rule fill:#3CA0B0,stroke:#99F6E4,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef code fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;

    DOC(( Document ))
    CH1(( Chunk ))
    CH2(( Chunk ))
    D(( Domain ))
    F(( Feature ))
    R(( BusinessRule ))
    A(( API ))
    E(( Entity ))
    DS(( Decision ))
    C(( Class ))
    M(( Method ))

    DOC -->|HAS_CHUNK| CH1
    CH1 -->|NEXT_CHUNK| CH2
    CH1 -->|MENTIONS| D
    CH1 -->|MENTIONS| F
    CH1 -->|MENTIONS| R
    CH1 -->|MENTIONS| A
    CH1 -->|MENTIONS| E
    CH1 -->|EXPLAINS| DS
    DS -->|AFFECTS| F
    F -->|IMPLEMENTED_BY| C
    C -->|CONTAINS| M
    R -->|ENFORCED_BY| M

    linkStyle 0,1,2,3,4,5,6,7,8,9,10 stroke:#6B7280,stroke-width:1px;
    linkStyle 11 stroke:#7C8AA5,stroke-width:1px;

    class DOC,CH1,CH2 doc;
    class D,F,A,E,DS business;
    class R rule;
    class C,M code;
    style DOC width:120px,height:120px;
    style CH1 width:120px,height:120px;
    style CH2 width:120px,height:120px;
    style D width:120px,height:120px;
    style F width:120px,height:120px;
    style R width:120px,height:120px;
    style A width:120px,height:120px;
    style E width:120px,height:120px;
    style DS width:120px,height:120px;
    style C width:120px,height:120px;
    style M width:120px,height:120px;
```

## Schema D: rule-centered project model

This is the best schema when business logic safety matters more than broad conceptual coverage.

Core nodes:

- `Policy`
- `BusinessRule`
- `Constraint`
- `Exception`
- `Feature`
- `UseCase`
- `Field`
- `API`
- `Validator`
- `TestCase`
- `Risk`

Typical relationships:

- `DEFINES`
- `APPLIES_TO`
- `HAS_EXCEPTION`
- `ENFORCED_BY`
- `VERIFIED_BY`
- `PROTECTS`
- `RISKS_BREAKING`

Why it is good:

- ideal for parity validation and regression prevention
- useful where rules are dispersed across many files and layers
- makes compliance and validation logic explicit

```mermaid
flowchart TD
    classDef policy fill:#A45FA8,stroke:#F5D0FE,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef feature fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef enforcement fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef risk fill:#C05F93,stroke:#FDA4AF,stroke-width:2px,color:#F8FAFC,font-size:16px;

    P(( Policy ))
    R(( BusinessRule ))
    F(( Feature ))
    U(( UseCase ))
    FLD(( Field ))
    A(( API ))
    V(( Validator ))
    T(( TestCase ))
    EX(( Exception ))
    RK(( Risk ))

    P -->|DEFINES| R
    R -->|APPLIES_TO| F
    F -->|IMPLEMENTS| U
    R -->|APPLIES_TO| FLD
    R -->|ENFORCED_BY| A
    R -->|ENFORCED_BY| V
    R -->|VERIFIED_BY| T
    R -->|HAS_EXCEPTION| EX
    R -->|RISKS_BREAKING| RK

    linkStyle 0,1,2,3,4,5,6,7 stroke:#6B7280,stroke-width:1px;
    linkStyle 8 stroke:#A56C92,stroke-width:2px;

    class P,R,EX policy;
    class F,U,FLD feature;
    class A,V,T enforcement;
    class RK risk;
    style P width:120px,height:120px;
    style R width:120px,height:120px;
    style F width:120px,height:120px;
    style U width:120px,height:120px;
    style FLD width:120px,height:120px;
    style A width:120px,height:120px;
    style V width:120px,height:120px;
    style T width:120px,height:120px;
    style EX width:120px,height:120px;
    style RK width:120px,height:120px;
```

## Best overall recommendation

For a web-development project, the most effective overall schema is usually a hybrid of Schema A and Schema C, with selected parts of Schema B.

Recommended backbone:

- `Domain`
- `Feature`
- `UseCase`
- `BusinessRule`
- `Entity`

Recommended implementation layer:

- `UIPage`
- `API`
- `Service`
- `Class`
- `Method`
- `Table`
- `ExternalSystem`

Recommended provenance layer:

- `Document`
- `Chunk`
- `Decision`

Recommended bridging rules:

- `Feature` should be the central anchor between business and implementation
- `BusinessRule` should connect to both business context and code enforcement
- document nodes should support traceability, not replace curated domain modeling
- low-level code detail should be added selectively to avoid graph noise

```mermaid
flowchart TD
    classDef domain fill:#7068CC,stroke:#DDD6FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef feature fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef rule fill:#3CA0B0,stroke:#99F6E4,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef impl fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef doc fill:#1F2937,stroke:#6B7280,stroke-width:2px,color:#E5E7EB,font-size:16px;

    D(( Domain ))
    F(( Feature ))
    U(( UseCase ))
    R(( BusinessRule ))
    E(( Entity ))
    UI(( UIPage ))
    A(( API ))
    SV(( Service ))
    C(( Class ))
    M(( Method ))
    T(( Table ))
    X(( ExternalSystem ))
    DOC(( Document ))
    CH(( Chunk ))
    DS(( Decision ))

    D --> F
    F --> U
    U --> R
    F --> E

    UI --> U
    F --> A
    F --> SV
    SV --> C
    C --> M
    SV --> T
    SV --> X
    R --> M

    DOC --> CH
    CH --> F
    CH --> R
    CH --> DS
    DS --> F

    linkStyle default stroke:#6B7280,stroke-width:1px;

    class D domain;
    class F,U,E,UI,A feature;
    class R rule;
    class SV,C,M,T,X impl;
    class DOC,CH,DS doc;
    style D width:120px,height:120px;
    style F width:120px,height:120px;
    style U width:120px,height:120px;
    style R width:120px,height:120px;
    style E width:120px,height:120px;
    style UI width:120px,height:120px;
    style A width:120px,height:120px;
    style SV width:120px,height:120px;
    style C width:120px,height:120px;
    style M width:120px,height:120px;
    style T width:120px,height:120px;
    style X width:120px,height:120px;
    style DOC width:120px,height:120px;
    style CH width:120px,height:120px;
    style DS width:120px,height:120px;
```

## Multi-source evidence graph for rule authority

If knowledge comes from Confluence, Jira, and implemented code at the same time, the best approach is not to merge them into one flat `BusinessRule` fact and not to choose one source too early.

The stronger pattern is:

- keep one canonical business layer with `Feature`, `UseCase`, `BusinessRule`, and `Context`
- attach source-specific evidence as separate nodes
- store source authority, freshness, and implementation state explicitly
- compute answer confidence from evidence instead of treating all statements as equally true

This aligns well with Neo4j's current lexical-plus-domain guidance and with W3C provenance modeling: keep the domain graph as the stable semantic layer, and connect it to document/code evidence rather than replacing it with raw source text.

### Why this is the best fit

For this specific problem, the sources do not have equal meaning:

- code usually expresses the strongest currently enforced business rules
- Jira usually expresses approved or planned decisions that may be partly implemented or not implemented yet
- Confluence usually expresses intent, background, or candidate ideas

Because of that, source strength should be modeled as evidence metadata and derived status, not as the identity of the rule itself.

The graph should answer two different questions separately:

- "What is the current enforced rule?"
- "What do our sources say, and how strong is each source?"

That separation avoids a common failure mode where planned Jira behavior or old Confluence ideas accidentally look as authoritative as running code.

### Recommended modeling pattern

Recommended stable nodes:

- `Feature`
- `UseCase`
- `BusinessRule`
- `Context`
- `CodeEvidence`
- `Document`
- `Chunk`
- `Decision`
- `RuleAssessment`

Recommended source metadata on `Document` or `CodeEvidence`:

- `sourceType`: `code`, `jira`, `confluence`
- `authorityRank`: for example `100`, `70`, `40`
- `freshnessAt`
- `status`: for example `implemented`, `planned`, `idea`, `superseded`
- `url` or `filePath`

Recommended relations:

- `Chunk -[:CLAIMS]-> BusinessRule`
- `CodeEvidence -[:ENFORCES]-> BusinessRule`
- `Decision -[:DECIDES]-> BusinessRule`
- `BusinessRule -[:HOLDS_IN]-> Context`
- `BusinessRule -[:ASSESSED_AS]-> RuleAssessment`
- `RuleAssessment -[:BASED_ON]-> Chunk`
- `RuleAssessment -[:BASED_ON]-> CodeEvidence`
- `Chunk -[:PART_OF]-> Document`

`RuleAssessment` is the important addition. It is where the graph records the interpreted state of the rule, such as:

- `effectiveStrength`: `enforced`, `decided`, `proposed`
- `confidence`: numeric score such as `0.95`
- `conflictLevel`: `none`, `low`, `high`
- `resolutionNote`
- `assessedAt`

This keeps the rule itself stable while allowing the graph to say that the same rule is strongly enforced in code, only planned in Jira, or merely suggested in Confluence.

```mermaid
flowchart TD
    classDef feature fill:#7068CC,stroke:#DDD6FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef operation fill:#5D79D2,stroke:#C7D2FE,stroke-width:2.5px,color:#F8FAFC,font-size:16px;
    classDef concept fill:#4A94BF,stroke:#BAE6FD,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef context fill:#4D8BC8,stroke:#BFDBFE,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef rule fill:#3CA0B0,stroke:#99F6E4,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef code fill:#2FA593,stroke:#A7F3D0,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef data fill:#2C9F78,stroke:#86EFAC,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef danger fill:#B45E9E,stroke:#FBCFE8,stroke-width:2px,color:#F8FAFC,font-size:16px;
    classDef doc fill:#1F2937,stroke:#6B7280,stroke-width:2px,color:#E5E7EB,font-size:16px;

    F(( Feature ))
    U(( UseCase ))
    R(( BusinessRule ))
    CTX(( Context ))
    RA(( RuleAssessment ))
    CE(( CodeEvidence ))
    DOC1(( ConfluenceDoc ))
    DOC2(( JiraTicket ))
    CH1(( Chunk ))
    CH2(( Chunk ))
    DS(( Decision ))

    F --> U
    U --> R
    R --> CTX
    R --> RA

    CE --> R
    CE --> RA

    DOC1 --> CH1
    DOC2 --> CH2
    CH1 --> R
    CH2 --> R
    CH2 --> DS
    DS --> R
    CH1 --> RA
    CH2 --> RA

    linkStyle default stroke:#6B7280,stroke-width:1px;

    class F feature;
    class U operation;
    class R rule;
    class CTX context;
    class RA danger;
    class CE code;
    class DOC1,DOC2,CH1,CH2 doc;
    class DS concept;
    style F width:120px,height:120px;
    style U width:120px,height:120px;
    style R width:120px,height:120px;
    style CTX width:120px,height:120px;
    style RA width:120px,height:120px;
    style CE width:120px,height:120px;
    style DOC1 width:120px,height:120px;
    style DOC2 width:120px,height:120px;
    style CH1 width:120px,height:120px;
    style CH2 width:120px,height:120px;
    style DS width:120px,height:120px;
```

### How to represent source strength

The cleanest approach is a two-part model:

1. `authorityRank` by source class
2. `confidence` by actual evidence quality

Suggested default authority order:

- code: strongest for current behavior
- Jira: medium strength for approved or in-flight decisions
- Confluence: weaker for ideas, rationale, and background

Suggested interpretation:

- `authorityRank` answers how much the source type should matter
- `confidence` answers how certain we are that this specific statement is still valid

That means a Jira ticket can outrank old code only when the graph also knows the code is stale, dead, feature-flagged off, or intentionally being replaced. In other words, source precedence is a default, not an absolute law.

### Recommended query behavior

For safe answers, query in this order:

1. return `BusinessRule`
2. expand to `RuleAssessment`
3. expand to supporting `CodeEvidence`, `Decision`, `Document`, and `Chunk`
4. sort by `effectiveStrength`, `authorityRank`, `freshnessAt`, and `confidence`
5. surface conflicts explicitly instead of hiding them

This allows the graph to produce answers like:

- enforced in code, supported by two methods, confidence high
- planned in Jira, not yet implemented, confidence medium
- mentioned in Confluence only, confidence low

### Practical recommendation for this repository

For this repository, the best extension of the current graph is:

- keep the existing business-first backbone
- keep `CodeEvidence` as the strongest implementation anchor
- add a provenance subgraph with `Document`, `Chunk`, and `Decision`
- add `RuleAssessment` as the explicit place where cross-source interpretation lives
- mark answers `needs_review` when Jira, Confluence, and code disagree

This is better than a single weighted edge model because it stays explainable. Engineers can see not only that a rule is "strong", but why it is strong, which source made it strong, and whether there is an intentional planned change already recorded elsewhere.

## Practical guidance

When writing Mermaid in Markdown, it should be placed in fenced code blocks with the `mermaid` info string:

```mermaid
graph TD
    style A fill:#7068CC,stroke:#DDD6FE,color:#F8FAFC
    style B fill:#5D79D2,stroke:#C7D2FE,color:#F8FAFC
    A[Domain] --> B[Feature]
    linkStyle default stroke:#6B7280,stroke-width:1px;
```

That is the right format for markdown-based documentation because:

- it keeps the source readable
- it renders in tools that support Mermaid
- it degrades gracefully as plain text where Mermaid rendering is unavailable

## Source notes

This investigation was based on:

- Neo4j documentation and blog material on knowledge graph generation, lexical and domain graph patterns, and schema guidance
- GraphRAG pattern guidance from Neo4j on combining lexical and domain subgraphs
- Neo4j material on codebase knowledge graphs and layered code graph modeling
- W3C provenance guidance for modeling source traceability and qualified evidence
- Joern and code property graph references for common code-graph structure

Useful references:

- https://graphrag.com/reference/knowledge-graph/domain-graph/
- https://graphrag.com/reference/knowledge-graph/lexical-graph/
- https://graphrag.com/reference/knowledge-graph/lexical-graph-extracted-entities/
- https://graphrag.com/reference/knowledge-graph/lexical-graph-hierarchical-structure/
- https://www.w3.org/TR/prov-o/
- https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_kg_builder.html
- https://neo4j.com/blog/developer/knowledge-graph-generation/
- https://neo4j.com/blog/developer/codebase-knowledge-graph/
- https://neo4j.com/blog/developer/describing-property-graph-data-model/
- https://neo4j.com/blog/developer/graph-type-schema-enforcement-made-easy-preview/
- https://docs.joern.io/code-property-graph/
- https://cpg.joern.io/
