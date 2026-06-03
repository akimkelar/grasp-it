import type { FrameworkConfig } from "../types.js";

export const grailsConfig = {
  id: "grails",
  displayName: "Grails",
  languages: ["groovy", "java"],
  detectionKeywords: ["grails", "org.grails", "grails-core", "gorm"],
  manifestFiles: ["build.gradle", "grails-app/conf/application.yml"],
  promptSnippetPath: "./frameworks/grails.md",
  entryPoints: [
    "grails-app/controllers/**/*Controller.groovy",
    "grails-app/init/*Application.groovy",
  ],
  layerHints: {
    controller: "api",
    service: "service",
    domain: "data",
    repository: "data",
    job: "service",
    taglib: "ui",
    interceptor: "middleware",
    conf: "config",
    command: "types",
    dto: "types",
  },
} satisfies FrameworkConfig;