import { describe, it, expect } from "vitest";
import { buildResult } from "../../skills/grasp/extract-structure.mjs";

const file = (overrides = {}) => ({
  path: "src/foo.py",
  language: "python",
  fileCategory: "code",
  ...overrides,
});

const analysis = (overrides = {}) => ({
  functions: [],
  classes: [],
  imports: [],
  exports: [],
  ...overrides,
});

describe("extract-structure buildResult", () => {
  describe("language pass-through", () => {
    it("preserves the input language on the output", () => {
      const result = buildResult(file({ language: "python" }), 10, 8, analysis(), null, {});
      expect(result.language).toBe("python");
    });

    it("preserves null when caller did not set a language", () => {
      // Documents the failure mode the SKILL.md/file-analyzer.md fix prevents:
      // if the dispatch prompt loses `language`, it propagates to the output.
      const result = buildResult(file({ language: null }), 10, 8, analysis(), null, {});
      expect(result.language).toBeNull();
    });
  });

  describe("importCount fallback", () => {
    // Only relative imports count toward the fallback metric — external
    // package imports would never produce edges so counting them would be
    // misleading. (`.helpers`, `..util`, `./local` all start with `.`)
    const analysisWithImports = analysis({
      imports: [
        { source: ".helpers", specifiers: [] },
        { source: "..util", specifiers: [] },
        { source: "./local", specifiers: [] },
      ],
    });

    it("uses pre-resolved imports when batchImportData has entries", () => {
      const batchImportData = { "src/foo.py": ["src/bar.py", "src/baz.py"] };
      const result = buildResult(file(), 10, 8, analysisWithImports, null, batchImportData);
      expect(result.metrics.importCount).toBe(2);
    });

    it("falls back to parser imports when batchImportData entry is an empty array", () => {
      // Regression test: empty arrays are truthy in JS, so a naive `if (importPaths)`
      // would clobber the parser's count with 0. This is the bug Python projects
      // using absolute imports (which the project scanner doesn't resolve) hit.
      const batchImportData = { "src/foo.py": [] };
      const result = buildResult(file(), 10, 8, analysisWithImports, null, batchImportData);
      expect(result.metrics.importCount).toBe(3);
    });

    it("falls back to parser imports when batchImportData has no entry for the file", () => {
      const result = buildResult(file(), 10, 8, analysisWithImports, null, {});
      expect(result.metrics.importCount).toBe(3);
    });

    it("falls back to parser imports when batchImportData is undefined", () => {
      const result = buildResult(file(), 10, 8, analysisWithImports, null, undefined);
      expect(result.metrics.importCount).toBe(3);
    });

    it("reports 0 imports when neither source has any", () => {
      const result = buildResult(file(), 10, 8, analysis(), null, { "src/foo.py": [] });
      expect(result.metrics.importCount).toBe(0);
    });

    it("excludes external package imports from the fallback count", () => {
      // Regression: pre-2.6.2 the fallback counted ALL parser imports (incl.
      // `os`, `sys`, etc.), so files where the scanner couldn't resolve
      // anything would over-report imports vs. files where it could.
      const ext = analysis({
        imports: [
          { source: "os", specifiers: [] },
          { source: "sys", specifiers: [] },
          { source: "./local", specifiers: [] },
        ],
      });
      const result = buildResult(file(), 10, 8, ext, null, {});
      expect(result.metrics.importCount).toBe(1);
    });
  });

  describe("null analysis", () => {
    it("returns base metrics only when analysis is null", () => {
      const result = buildResult(file(), 10, 8, null, null, {});
      expect(result.metrics).toEqual({});
      expect(result.functions).toBeUndefined();
      expect(result.classes).toBeUndefined();
      expect(result.exports).toBeUndefined();
    });
  });

  describe("functions mapping", () => {
    it("maps functions with name, startLine, endLine, params", () => {
      const a = analysis({ functions: [{ name: "foo", lineRange: [1, 5], params: ["x"] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.functions).toEqual([{ name: "foo", startLine: 1, endLine: 5, params: ["x"] }]);
    });

    it("omits functions when array is empty", () => {
      const result = buildResult(file(), 10, 8, analysis({ functions: [] }), null, {});
      expect(result.functions).toBeUndefined();
    });
  });

  describe("classes mapping", () => {
    it("maps classes with name, startLine, endLine, methods, properties", () => {
      const a = analysis({ classes: [{ name: "Bar", lineRange: [2, 10], methods: ["m"], properties: ["p"] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.classes).toEqual([{ name: "Bar", startLine: 2, endLine: 10, methods: ["m"], properties: ["p"] }]);
    });
  });

  describe("exports mapping", () => {
    it("maps exports with name, line, isDefault", () => {
      const a = analysis({ exports: [{ name: "foo", lineNumber: 3, isDefault: true }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.exports).toEqual([{ name: "foo", line: 3, isDefault: true }]);
    });
  });

  describe("sections mapping", () => {
    it("maps sections with heading, level, line", () => {
      const a = analysis({ sections: [{ name: "Intro", level: 1, lineRange: [1, 5] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.sections).toEqual([{ heading: "Intro", level: 1, line: 1 }]);
    });
  });

  describe("definitions mapping", () => {
    it("maps definitions with name, kind, fields, startLine, endLine", () => {
      const a = analysis({ definitions: [{ name: "MyType", kind: "interface", fields: ["id"], lineRange: [3, 7] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.definitions).toEqual([{ name: "MyType", kind: "interface", fields: ["id"], startLine: 3, endLine: 7 }]);
    });
  });

  describe("services mapping", () => {
    it("maps services with name, image, ports, startLine, endLine when lineRange present", () => {
      const a = analysis({ services: [{ name: "db", image: "postgres", ports: [5432], lineRange: [1, 4] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.services).toEqual([{ name: "db", image: "postgres", ports: [5432], startLine: 1, endLine: 4 }]);
    });

    it("maps services without startLine/endLine when lineRange absent", () => {
      const a = analysis({ services: [{ name: "web", image: "nginx", ports: [80] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.services[0].startLine).toBeUndefined();
    });
  });

  describe("endpoints mapping", () => {
    it("maps endpoints with method, path, startLine, endLine", () => {
      const a = analysis({ endpoints: [{ method: "GET", path: "/api", lineRange: [2, 3] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.endpoints).toEqual([{ method: "GET", path: "/api", startLine: 2, endLine: 3 }]);
    });
  });

  describe("steps mapping", () => {
    it("maps steps with name, startLine, endLine", () => {
      const a = analysis({ steps: [{ name: "build", lineRange: [1, 2] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.steps).toEqual([{ name: "build", startLine: 1, endLine: 2 }]);
    });
  });

  describe("resources mapping", () => {
    it("maps resources with name, kind, startLine, endLine", () => {
      const a = analysis({ resources: [{ name: "Pod", kind: "pod", lineRange: [5, 10] }] });
      const result = buildResult(file(), 10, 8, a, null, {});
      expect(result.resources).toEqual([{ name: "Pod", kind: "pod", startLine: 5, endLine: 10 }]);
    });
  });

  describe("callGraph", () => {
    it("includes callGraph when non-empty", () => {
      const cg = [{ caller: "a", callee: "b", lineNumber: 3 }];
      const result = buildResult(file(), 10, 8, analysis(), cg, {});
      expect(result.callGraph).toEqual(cg);
    });

    it("omits callGraph when null", () => {
      const result = buildResult(file(), 10, 8, analysis(), null, {});
      expect(result.callGraph).toBeUndefined();
    });

    it("omits callGraph when empty array", () => {
      const result = buildResult(file(), 10, 8, analysis(), [], {});
      expect(result.callGraph).toBeUndefined();
    });
  });

  describe("metric counts", () => {
    it("sets exportCount", () => {
      const a = analysis({ exports: [{ name: "x", lineNumber: 1, isDefault: false }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.exportCount).toBe(1);
    });

    it("sets functionCount", () => {
      const a = analysis({ functions: [{ name: "f", lineRange: [1, 2], params: [] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.functionCount).toBe(1);
    });

    it("sets classCount", () => {
      const a = analysis({ classes: [{ name: "C", lineRange: [1, 5], methods: [], properties: [] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.classCount).toBe(1);
    });

    it("sets sectionCount", () => {
      const a = analysis({ sections: [{ name: "S", level: 1, lineRange: [1, 2] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.sectionCount).toBe(1);
    });

    it("sets definitionCount", () => {
      const a = analysis({ definitions: [{ name: "D", kind: "type", fields: [], lineRange: [1, 2] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.definitionCount).toBe(1);
    });

    it("sets serviceCount", () => {
      const a = analysis({ services: [{ name: "svc", image: "img", ports: [] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.serviceCount).toBe(1);
    });

    it("sets endpointCount", () => {
      const a = analysis({ endpoints: [{ method: "POST", path: "/x", lineRange: [1, 2] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.endpointCount).toBe(1);
    });

    it("sets stepCount", () => {
      const a = analysis({ steps: [{ name: "step1", lineRange: [1, 2] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.stepCount).toBe(1);
    });

    it("sets resourceCount", () => {
      const a = analysis({ resources: [{ name: "res", kind: "pod", lineRange: [1, 2] }] });
      expect(buildResult(file(), 10, 8, a, null, {}).metrics.resourceCount).toBe(1);
    });
  });

  describe("totalLines", () => {
    // Documents the off-by-one fix: `wc -l` reports N for a POSIX text file
    // with N lines + trailing \n; the extractor must match.
    it("matches wc -l semantics for trailing-newline files", () => {
      // Mimic what main() computes: read file, split on \n.
      // Build a synthetic 3-line file ending in \n.
      const content = "a\nb\nc\n";
      const lines = content.split("\n"); // ["a","b","c",""]
      const totalLines = content.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
      expect(totalLines).toBe(3);
    });

    it("counts content without trailing newline correctly", () => {
      const content = "a\nb\nc";
      const lines = content.split("\n");
      const totalLines = content.endsWith("\n") ? Math.max(0, lines.length - 1) : lines.length;
      expect(totalLines).toBe(3);
    });

  });
});
