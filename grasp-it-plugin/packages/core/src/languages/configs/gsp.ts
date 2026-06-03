import type { LanguageConfig } from "../types.js";

export const gspConfig = {
  id: "gsp",
  displayName: "Grails Server Pages",
  extensions: [".gsp"],
  concepts: ["server-side rendering", "Grails tag libraries", "controller references"],
  filePatterns: { entryPoints: [], barrels: [], tests: [], config: [] },
} satisfies LanguageConfig;