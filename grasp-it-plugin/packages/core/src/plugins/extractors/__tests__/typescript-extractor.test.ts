import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import { TypeScriptExtractor } from "../typescript-extractor.js";

const require = createRequire(import.meta.url);

// Load tree-sitter + TypeScript grammar once
let Parser: any;
let Language: any;
let typescriptLang: any;

beforeAll(async () => {
  const mod = await import("web-tree-sitter");
  Parser = mod.Parser;
  Language = mod.Language;
  await Parser.init();
  const wasmPath = require.resolve(
    "tree-sitter-typescript/tree-sitter-typescript.wasm",
  );
  typescriptLang = await Language.load(wasmPath);
});

function parse(code: string) {
  const parser = new Parser();
  parser.setLanguage(typescriptLang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  return { tree, parser, root };
}

describe("TypeScriptExtractor", () => {
  const extractor = new TypeScriptExtractor();

  it("has correct languageIds", () => {
    expect(extractor.languageIds).toEqual(["typescript", "javascript"]);
  });

  // ---- Functions ----

  describe("extractStructure - functions", () => {
    it("extracts simple function declarations", () => {
      const { tree, parser, root } = parse(`
function greet(name: string): string {
  return "Hello " + name;
}

function add(a: number, b: number): number {
  return a + b;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);

      expect(result.functions[0].name).toBe("greet");
      expect(result.functions[0].params).toEqual(["name"]);
      expect(result.functions[0].returnType).toBe("string");
      expect(result.functions[0].lineRange[0]).toBeGreaterThan(0);

      expect(result.functions[1].name).toBe("add");
      expect(result.functions[1].params).toEqual(["a", "b"]);
      expect(result.functions[1].returnType).toBe("number");

      tree.delete();
      parser.delete();
    });

    it("extracts function declarations without type annotations", () => {
      const { tree, parser, root } = parse(`
function noop() {}

function identity(x) {
  return x;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("noop");
      expect(result.functions[0].params).toEqual([]);
      expect(result.functions[0].returnType).toBeUndefined();

      expect(result.functions[1].name).toBe("identity");
      expect(result.functions[1].params).toEqual(["x"]);

      tree.delete();
      parser.delete();
    });

    it("extracts arrow functions assigned to const", () => {
      const { tree, parser, root } = parse(`
const double = (x: number): number => x * 2;
const greet = (name: string) => \`Hello \${name}\`;
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(2);
      expect(result.functions[0].name).toBe("double");
      expect(result.functions[0].params).toEqual(["x"]);
      expect(result.functions[1].name).toBe("greet");
      expect(result.functions[1].params).toEqual(["name"]);

      tree.delete();
      parser.delete();
    });

    it("extracts function expressions assigned to const", () => {
      const { tree, parser, root } = parse(`
const compute = function(a: number, b: number): number {
  return a + b;
};
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("compute");
      expect(result.functions[0].params).toEqual(["a", "b"]);

      tree.delete();
      parser.delete();
    });

    it("extracts functions with optional parameters", () => {
      const { tree, parser, root } = parse(`
function connect(host: string, port?: number): void {}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].name).toBe("connect");
      expect(result.functions[0].params).toEqual(["host", "port"]);

      tree.delete();
      parser.delete();
    });

    it("extracts functions with rest parameters", () => {
      const { tree, parser, root } = parse(`
function log(...args: string[]): void {}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].params).toEqual(["...args"]);

      tree.delete();
      parser.delete();
    });

    it("reports correct function line ranges", () => {
      const { tree, parser, root } = parse(`
function multiline(
  a: number,
  b: number,
): number {
  return a + b;
}
`);
      const result = extractor.extractStructure(root);

      expect(result.functions).toHaveLength(1);
      expect(result.functions[0].lineRange[0]).toBe(2);
      expect(result.functions[0].lineRange[1]).toBe(7);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Classes ----

  describe("extractStructure - classes", () => {
    it("extracts classes with methods and properties", () => {
      const { tree, parser, root } = parse(`
class DataProcessor {
  name: string;
  count: number;

  constructor(name: string) {
    this.name = name;
    this.count = 0;
  }

  process(data: string[]): string {
    return data.join(",");
  }
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("DataProcessor");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("process");
      expect(result.classes[0].properties).toContain("name");
      expect(result.classes[0].properties).toContain("count");

      tree.delete();
      parser.delete();
    });

    it("extracts class with no members", () => {
      const { tree, parser, root } = parse(`
class Empty {}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("Empty");
      expect(result.classes[0].methods).toEqual([]);
      expect(result.classes[0].properties).toEqual([]);

      tree.delete();
      parser.delete();
    });

    it("extracts multiple classes", () => {
      const { tree, parser, root } = parse(`
class Foo {
  bar(): void {}
}

class Baz {
  qux(): void {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(2);
      expect(result.classes[0].name).toBe("Foo");
      expect(result.classes[1].name).toBe("Baz");

      tree.delete();
      parser.delete();
    });

    it("reports correct class line ranges", () => {
      const { tree, parser, root } = parse(`
class MyClass {
  methodA(): void {}
  methodB(): void {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].lineRange[0]).toBe(2);
      expect(result.classes[0].lineRange[1]).toBe(5);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Imports ----

  describe("extractStructure - imports", () => {
    it("extracts named imports", () => {
      const { tree, parser, root } = parse(`
import { foo, bar } from "./module";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("./module");
      expect(result.imports[0].specifiers).toEqual(["foo", "bar"]);
      expect(result.imports[0].lineNumber).toBe(2);

      tree.delete();
      parser.delete();
    });

    it("extracts default imports", () => {
      const { tree, parser, root } = parse(`
import MyLib from "my-lib";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("my-lib");
      expect(result.imports[0].specifiers).toContain("MyLib");

      tree.delete();
      parser.delete();
    });

    it("extracts namespace imports", () => {
      const { tree, parser, root } = parse(`
import * as fs from "node:fs";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].source).toBe("node:fs");
      expect(result.imports[0].specifiers).toContain("* as fs");

      tree.delete();
      parser.delete();
    });

    it("extracts aliased named imports", () => {
      const { tree, parser, root } = parse(`
import { foo as bar } from "./utils";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(1);
      expect(result.imports[0].specifiers).toContain("bar");

      tree.delete();
      parser.delete();
    });

    it("extracts multiple import statements", () => {
      const { tree, parser, root } = parse(`
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as os from "node:os";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0].source).toBe("node:fs/promises");
      expect(result.imports[1].source).toBe("node:path");
      expect(result.imports[2].source).toBe("node:os");

      tree.delete();
      parser.delete();
    });

    it("reports correct import line numbers", () => {
      const { tree, parser, root } = parse(`
import { a } from "./a";
import { b } from "./b";
`);
      const result = extractor.extractStructure(root);

      expect(result.imports[0].lineNumber).toBe(2);
      expect(result.imports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Exports ----

  describe("extractStructure - exports", () => {
    it("extracts named export functions", () => {
      const { tree, parser, root } = parse(`
export function hello(): void {}
export function world(): void {}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("hello");
      expect(exportNames).toContain("world");

      tree.delete();
      parser.delete();
    });

    it("marks default export functions correctly", () => {
      const { tree, parser, root } = parse(`
export default function main(): void {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].isDefault).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts named export classes", () => {
      const { tree, parser, root } = parse(`
export class MyService {
  run(): void {}
}
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("MyService");
      expect(result.exports[0].isDefault).toBeFalsy();

      tree.delete();
      parser.delete();
    });

    it("extracts default export classes", () => {
      const { tree, parser, root } = parse(`
export default class Controller {
  handle(): void {}
}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports).toHaveLength(1);
      expect(result.exports[0].name).toBe("default");
      expect(result.exports[0].isDefault).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts export clause (re-exports)", () => {
      const { tree, parser, root } = parse(`
const foo = 1;
const bar = 2;
export { foo, bar };
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("foo");
      expect(exportNames).toContain("bar");

      tree.delete();
      parser.delete();
    });

    it("extracts export clause with alias", () => {
      const { tree, parser, root } = parse(`
const internal = 42;
export { internal as publicValue };
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("publicValue");

      tree.delete();
      parser.delete();
    });

    it("extracts exported const arrow functions", () => {
      const { tree, parser, root } = parse(`
export const handler = (req: unknown): void => {};
`);
      const result = extractor.extractStructure(root);

      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("handler");

      tree.delete();
      parser.delete();
    });

    it("reports correct export line numbers", () => {
      const { tree, parser, root } = parse(`
export function alpha(): void {}
export function beta(): void {}
`);
      const result = extractor.extractStructure(root);

      expect(result.exports[0].lineNumber).toBe(2);
      expect(result.exports[1].lineNumber).toBe(3);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Call Graph ----

  describe("extractCallGraph", () => {
    it("extracts function calls inside function declarations", () => {
      const { tree, parser, root } = parse(`
function process(data: string[]): string {
  const result = transform(data);
  return format(result);
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result.length).toBeGreaterThanOrEqual(2);
      const callees = result.map((e) => e.callee);
      expect(callees).toContain("transform");
      expect(callees).toContain("format");
      result.forEach((e) => expect(e.caller).toBe("process"));

      tree.delete();
      parser.delete();
    });

    it("extracts calls inside arrow functions", () => {
      const { tree, parser, root } = parse(`
const run = () => {
  doSomething();
};
`);
      const result = extractor.extractCallGraph(root);

      expect(result.some((e) => e.caller === "run" && e.callee === "doSomething")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("extracts calls inside class methods", () => {
      const { tree, parser, root } = parse(`
class Service {
  start(): void {
    this.setup();
    runServer();
  }
}
`);
      const result = extractor.extractCallGraph(root);

      const startCalls = result.filter((e) => e.caller === "start");
      expect(startCalls.some((e) => e.callee === "this.setup")).toBe(true);
      expect(startCalls.some((e) => e.callee === "runServer")).toBe(true);

      tree.delete();
      parser.delete();
    });

    it("ignores top-level calls with no enclosing function", () => {
      const { tree, parser, root } = parse(`
console.log("hello");
main();
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(0);

      tree.delete();
      parser.delete();
    });

    it("reports correct line numbers for calls", () => {
      const { tree, parser, root } = parse(`
function main(): void {
  foo();
  bar();
}
`);
      const result = extractor.extractCallGraph(root);

      expect(result).toHaveLength(2);
      expect(result[0].lineNumber).toBe(3);
      expect(result[1].lineNumber).toBe(4);

      tree.delete();
      parser.delete();
    });
  });

  // ---- Comprehensive ----

  describe("comprehensive TypeScript module", () => {
    it("handles a realistic TypeScript file", () => {
      const { tree, parser, root } = parse(`
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Config {
  name: string;
  debug: boolean;
}

export class FileProcessor {
  private name: string;
  verbose: boolean;

  constructor(name: string) {
    this.name = name;
    this.verbose = false;
  }

  async process(filePath: string): Promise<string> {
    const full = path.resolve(filePath);
    return readFile(full, "utf-8");
  }
}

export function createProcessor(name: string): FileProcessor {
  return new FileProcessor(name);
}

export const defaultProcessor = new FileProcessor("default");
`);
      const result = extractor.extractStructure(root);

      // Imports
      expect(result.imports).toHaveLength(2);
      expect(result.imports[0].source).toBe("node:fs/promises");
      expect(result.imports[1].source).toBe("node:path");

      // Class
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe("FileProcessor");
      expect(result.classes[0].methods).toContain("constructor");
      expect(result.classes[0].methods).toContain("process");

      // Top-level function
      expect(result.functions.some((f) => f.name === "createProcessor")).toBe(true);

      // Exports
      const exportNames = result.exports.map((e) => e.name);
      expect(exportNames).toContain("FileProcessor");
      expect(exportNames).toContain("createProcessor");
      expect(exportNames).toContain("defaultProcessor");

      tree.delete();
      parser.delete();
    });
  });
});
