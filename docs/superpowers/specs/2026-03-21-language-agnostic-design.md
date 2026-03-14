# Language-Agnostic Support Design

**Date:** 2026-03-21
**Status:** Approved
**Issue:** Make Grasp-It codebase-aware and language-agnostic instead of TypeScript-heavy

## Problem

The tool's agent prompts, tree-sitter plugin, and language lesson system are heavily biased toward TypeScript/JavaScript. Non-TS codebases get degraded analysis because:

1. Agent prompts use TS-specific examples and concepts (e.g., "barrel files", "type guards", "generics")
2. Tree-sitter plugin only ships TS/JS grammar support — structural analysis silently fails for other languages
3. Language lesson detection hardcodes TS-specific concept patterns and display names

The architecture (PluginRegistry, GraphBuilder, dashboard, search) is already language-neutral. The bias is in shipped content, not the framework.

## Decisions

- **Scope:** All three layers — prompts, tree-sitter plugins, language framework
- **Languages (v1):** TypeScript, JavaScript, Python, Go, Java, Rust, C/C++, C#, Ruby, PHP, Swift, Kotlin
- **Architecture:** Config-first with code escape hatch (hybrid)
- **Prompt strategy:** Base prompt + per-language markdown snippet files in a `languages/` folder
- **Config location:** Prompt snippets in `skills/understand/languages/`, tree-sitter configs in `packages/core/src/languages/`
- **Multi-language projects:** Per-file language analysis + project-level multi-language summary
- **Language detection:** Auto-detect from file extensions only (no manual override for v1)

## Design

### 1. LanguageConfig Type & Registry

#### LanguageConfig Interface

```typescript
// packages/core/src/languages/types.ts
interface LanguageConfig {
  id: string;                          // e.g., "python"
  displayName: string;                 // e.g., "Python"
  extensions: string[];                // e.g., [".py", ".pyi"]
  treeSitter: {
    grammarPackage: string;            // npm package name
    nodeTypes: {
      function: string[];              // e.g., ["function_definition"]
      class: string[];                 // e.g., ["class_definition"]
      import: string[];                // e.g., ["import_statement", "import_from_statement"]
      export: string[];                // e.g., ["export_statement"] or [] for languages without exports
      typeAnnotation: string[];        // e.g., ["type"] for Python type hints
    };
  };
  concepts: string[];                  // e.g., ["decorators", "list comprehensions", "generators"]
  filePatterns?: Record<string, string>; // special files, e.g., {"config": "pyproject.toml"}
  customAnalyzer?: (node: SyntaxNode) => AnalysisResult; // escape hatch for unusual AST shapes
}
```

#### Language Registry

```typescript
// packages/core/src/languages/registry.ts
class LanguageRegistry {
  private configs: Map<string, LanguageConfig>;

  register(config: LanguageConfig): void;
  getByExtension(ext: string): LanguageConfig | null;
  getById(id: string): LanguageConfig;
  getAll(): LanguageConfig[];
}
```

#### File Structure

```
packages/core/src/languages/
├── types.ts
├── registry.ts
├── index.ts
├── configs/
│   ├── typescript.ts
│   ├── javascript.ts
│   ├── python.ts
│   ├── go.ts
│   ├── java.ts
│   ├── rust.ts
│   ├── cpp.ts
│   ├── csharp.ts
│   ├── ruby.ts
│   ├── php.ts
│   ├── swift.ts
│   └── kotlin.ts
```

All built-in configs auto-registered on import.

### 2. GenericTreeSitterPlugin

Replaces the current TS-only `TreeSitterPlugin` with a config-driven version.

```typescript
// packages/core/src/plugins/generic-tree-sitter-plugin.ts
class GenericTreeSitterPlugin implements AnalyzerPlugin {
  private registry: LanguageRegistry;

  canAnalyze(filePath: string): boolean {
    return this.registry.getByExtension(path.extname(filePath)) !== null;
  }

  async analyzeFile(filePath: string, content: string): Promise<FileAnalysis> {
    const config = this.registry.getByExtension(path.extname(filePath));

    // Custom analyzer escape hatch
    if (config.customAnalyzer) {
      return config.customAnalyzer(tree.rootNode);
    }

    // Generic extraction driven by config.treeSitter.nodeTypes
    const functions = this.extractNodes(tree, config.treeSitter.nodeTypes.function);
    const classes = this.extractNodes(tree, config.treeSitter.nodeTypes.class);
    const imports = this.extractNodes(tree, config.treeSitter.nodeTypes.import);
    const exports = this.extractNodes(tree, config.treeSitter.nodeTypes.export);
    // ...
  }

  private extractNodes(tree: Tree, nodeTypes: string[]): NodeInfo[] {
    // Walk AST, collect all nodes matching any of the given types
  }
}
```

#### Migration

- Current `TreeSitterPlugin` deleted, replaced by `GenericTreeSitterPlugin` + TS/JS configs
- `PluginRegistry` unchanged
- Existing tests updated to use new plugin

#### WASM Grammar Loading

- Each grammar loaded lazily on first use and cached
- WASM files bundled in `packages/core/src/languages/grammars/` or fetched from tree-sitter's official WASM builds

### 3. Language-Aware Prompts

#### File Structure

```
skills/understand/
├── file-analyzer-prompt.md            # Base prompt (language-neutral)
├── tour-builder-prompt.md
├── project-scanner-prompt.md
├── languages/
│   ├── typescript.md
│   ├── javascript.md
│   ├── python.md
│   ├── go.md
│   ├── java.md
│   ├── rust.md
│   ├── cpp.md
│   ├── csharp.md
│   ├── ruby.md
│   ├── php.md
│   ├── swift.md
│   └── kotlin.md
```

#### Base Prompt Changes

All TS-specific examples removed from base prompts. Replaced with injection point:

```markdown
## Language-Specific Guidance

{{LANGUAGE_CONTEXT}}
```

#### Language Markdown Format

Each language file contains:

```markdown
# Python

## Key Concepts
- Decorators, comprehensions, generators, context managers, type hints, dunder methods

## Import Patterns
- `import module`, `from module import name`, relative imports

## Notable File Patterns
- `__init__.py` (package initializer), `conftest.py` (pytest), `pyproject.toml` (config)

## Example Summary Style
> "FastAPI route handler that accepts a Pydantic model, validates input..."
```

#### Injection Logic

1. Project scanner detects languages present in the codebase
2. File-analyzer: inject matching language `.md` for that file's language
3. Tour-builder: inject all detected languages' `.md` files
4. Project-scanner: inject all detected languages' key concepts for project-level summary

#### Multi-Language Projects

Project-scanner prompt gets a combined section listing all detected languages with their key concepts.

### 4. Language Lesson Updates

- Delete `LANGUAGE_DISPLAY_NAMES` — use `LanguageRegistry.getById(id).displayName`
- Delete hardcoded concept patterns — use `LanguageConfig.concepts` from registry
- Language lesson generation becomes config-driven

### 5. Testing Strategy

#### Unit Tests

1. **LanguageConfig validation** — Each config has all required fields, non-empty nodeTypes
2. **LanguageRegistry** — Registration, lookup by extension/id, duplicate handling
3. **GenericTreeSitterPlugin per language** — Small fixture file per language verifying function/class/import extraction
4. **Language lesson generation** — Concepts sourced from config

#### Integration Tests

5. **Multi-language project** — Mixed TS + Python fixture, verify graph contains nodes from both languages
6. **Prompt injection** — Correct language `.md` injected based on detected language

#### Migration Tests

- Current tree-sitter-plugin tests rewritten for GenericTreeSitterPlugin with TS config
- Must produce identical results to validate non-breaking migration

### 6. Error Handling & Graceful Degradation

#### Key Principle

**Every file always gets analyzed.** Tree-sitter is an enhancement, not a gate. The LLM is the primary analyzer; structural analysis enriches it.

#### Unknown Language

- Tree-sitter skipped (returns `null`)
- LLM analysis still runs — file gets summary, tags, graph node
- Debug log: `"No language config for .xyz, skipping structural analysis"`

#### Missing WASM Grammar

- Warning logged, that language degrades to LLM-only
- Other languages unaffected

#### Malformed Language Config

- Validated at registration time via Zod schema
- Invalid config throws at startup — fail fast
