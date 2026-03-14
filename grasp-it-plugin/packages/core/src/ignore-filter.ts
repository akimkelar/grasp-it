import ignore, { type Ignore } from "ignore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Hardcoded default ignore patterns matching the project-scanner agent's
 * exclusion rules, plus bin/obj for .NET projects.
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  // Dependency directories
  "node_modules/",
  ".git/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",

  // Build output
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".cache/",
  ".turbo/",
  "target/",
  "obj/",

  // Lock files
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",

  // Binary/asset files
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",

  // Generated files
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",

  // IDE/editor
  ".idea/",
  ".vscode/",

  // Misc
  "LICENSE",
  ".gitignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc*",
  "*.log",
];

export interface IgnoreFilter {
  /** Returns true if the given relative path should be excluded from analysis. */
  isIgnored(relativePath: string): boolean;
}

/**
 * Creates an IgnoreFilter that merges hardcoded defaults with user-defined
 * patterns from .graspignore files.
 *
 * Pattern load order (later entries can override earlier ones via ! negation):
 * 1. Hardcoded defaults
 * 2. .grasp-it/.graspignore (if exists)
 * 3. .graspignore at project root (if exists)
 */
export function createIgnoreFilter(projectRoot: string): IgnoreFilter {
  const ig: Ignore = ignore();

  // Layer 1: hardcoded defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // Layer 2: .grasp-it/.graspignore
  const projectIgnorePath = join(projectRoot, ".grasp-it", ".graspignore");
  if (existsSync(projectIgnorePath)) {
    const content = readFileSync(projectIgnorePath, "utf-8");
    ig.add(content);
  }

  // Layer 3: .graspignore at project root
  const rootIgnorePath = join(projectRoot, ".graspignore");
  if (existsSync(rootIgnorePath)) {
    const content = readFileSync(rootIgnorePath, "utf-8");
    ig.add(content);
  }

  return {
    isIgnored(relativePath: string): boolean {
      return ig.ignores(relativePath);
    },
  };
}
