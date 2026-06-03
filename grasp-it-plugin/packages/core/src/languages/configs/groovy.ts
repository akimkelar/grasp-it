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