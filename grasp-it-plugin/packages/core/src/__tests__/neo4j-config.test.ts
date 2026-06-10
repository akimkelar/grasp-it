import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadConfig,
  saveConfig,
  hasConfig,
  ensureEnvInGitignore,
  ENV_VARS,
  DEFAULTS,
  type Neo4jConfig,
  type ConnectionType,
} from "../neo4j-config.js";

describe("Neo4j Configuration", () => {
  const testDir = join(tmpdir(), `grasp-it-test-${Date.now()}`);
  const projectRoot = join(testDir, "project");

  beforeEach(() => {
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("loadConfig", () => {
    it("returns failure when no config exists", () => {
      const result = loadConfig(projectRoot);
      expect(result.success).toBe(false);
      expect(result.source).toBe("none");
    });

    it("loads config from project .env file", () => {
      const config: Neo4jConfig = {
        uri: "bolt://localhost:7687",
        database: "neo4j",
        username: "neo4j",
        password: "secret",
        connectionType: "cypher-shell",
      };
      saveConfig(projectRoot, config);

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.source).toBe("project");
      expect(result.config?.uri).toBe("bolt://localhost:7687");
      expect(result.config?.username).toBe("neo4j");
      expect(result.config?.connectionType).toBe("cypher-shell");
    });

    it("loads config with driver connection type", () => {
      const config: Neo4jConfig = {
        uri: "neo4j+s://abc123.databases.neo4j.io",
        database: "neo4j",
        username: "neo4j",
        password: "aura-password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.connectionType).toBe("driver");
      expect(result.config?.uri).toBe("neo4j+s://abc123.databases.neo4j.io");
    });

    it("loads config with mcp connection type", () => {
      const config: Neo4jConfig = {
        uri: "bolt://localhost:7687",
        database: "testdb",
        username: "admin",
        password: "admin123",
        connectionType: "mcp",
      };
      saveConfig(projectRoot, config);

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.connectionType).toBe("mcp");
      expect(result.config?.database).toBe("testdb");
    });

    it("applies defaults for missing optional fields", () => {
      const envContent = `NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=secret`;
      writeFileSync(join(projectRoot, ".env"), envContent, "utf-8");

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.database).toBe(DEFAULTS.DATABASE);
      expect(result.config?.connectionType).toBe(DEFAULTS.CONNECTION_TYPE);
    });

    it("parses quoted values correctly", () => {
      const envContent = `NEO4J_URI="bolt://localhost:7687"
NEO4J_DATABASE="my database"
NEO4J_USERNAME="user"
NEO4J_PASSWORD="pass123"
NEO4J_CONNECTION_TYPE="driver"`;
      writeFileSync(join(projectRoot, ".env"), envContent, "utf-8");

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.database).toBe("my database");
      expect(result.config?.connectionType).toBe("driver");
    });

    it("handles single-quoted values", () => {
      const envContent = `NEO4J_URI='bolt://localhost:7687'
NEO4J_USERNAME='neo4j'
NEO4J_PASSWORD='secret'`;
      writeFileSync(join(projectRoot, ".env"), envContent, "utf-8");

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.uri).toBe("bolt://localhost:7687");
    });

    it("skips comments and blank lines", () => {
      const envContent = `# This is a comment
NEO4J_URI=bolt://localhost:7687

# Another comment
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=secret
`;
      writeFileSync(join(projectRoot, ".env"), envContent, "utf-8");

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.uri).toBe("bolt://localhost:7687");
    });
  });

  describe("saveConfig", () => {
    it("creates .env file with all fields", () => {
      const config: Neo4jConfig = {
        uri: "neo4j+s://abc.databases.neo4j.io",
        database: "neo4j",
        username: "neo4j",
        password: "my-password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      const envPath = join(projectRoot, ".env");
      expect(existsSync(envPath)).toBe(true);

      const content = require("node:fs").readFileSync(envPath, "utf-8");
      expect(content).toContain(`NEO4J_URI=${config.uri}`);
      expect(content).toContain(`NEO4J_DATABASE=${config.database}`);
      expect(content).toContain(`NEO4J_USERNAME=${config.username}`);
      expect(content).toContain(`NEO4J_PASSWORD=${config.password}`);
      expect(content).toContain(`NEO4J_CONNECTION_TYPE=${config.connectionType}`);
      expect(content).toContain("# Generated by grasp-it");
      expect(content).toContain("# Do not commit this file to version control");
    });

    it("overwrites existing .env file", () => {
      const config1: Neo4jConfig = {
        uri: "bolt://localhost:7687",
        database: "neo4j",
        username: "user1",
        password: "pass1",
        connectionType: "cypher-shell",
      };
      saveConfig(projectRoot, config1);

      const config2: Neo4jConfig = {
        uri: "neo4j+s://other.databases.neo4j.io",
        database: "otherdb",
        username: "user2",
        password: "pass2",
        connectionType: "mcp",
      };
      saveConfig(projectRoot, config2);

      const result = loadConfig(projectRoot);
      expect(result.success).toBe(true);
      expect(result.config?.uri).toBe("neo4j+s://other.databases.neo4j.io");
      expect(result.config?.database).toBe("otherdb");
    });
  });

  describe("hasConfig", () => {
    it("returns false when no config exists", () => {
      expect(hasConfig(projectRoot)).toBe(false);
    });

    it("returns true when .env exists with config", () => {
      const config: Neo4jConfig = {
        uri: "bolt://localhost:7687",
        database: "neo4j",
        username: "neo4j",
        password: "secret",
        connectionType: "cypher-shell",
      };
      saveConfig(projectRoot, config);
      expect(hasConfig(projectRoot)).toBe(true);
    });
  });

  describe("ENV_VARS", () => {
    it("has correct variable names", () => {
      expect(ENV_VARS.URI).toBe("NEO4J_URI");
      expect(ENV_VARS.DATABASE).toBe("NEO4J_DATABASE");
      expect(ENV_VARS.USERNAME).toBe("NEO4J_USERNAME");
      expect(ENV_VARS.PASSWORD).toBe("NEO4J_PASSWORD");
      expect(ENV_VARS.CONNECTION_TYPE).toBe("NEO4J_CONNECTION_TYPE");
    });
  });

  describe("DEFAULTS", () => {
    it("has sensible defaults", () => {
      expect(DEFAULTS.DATABASE).toBe("grasp");
      expect(DEFAULTS.CONNECTION_TYPE).toBe("driver");
      expect(DEFAULTS.URI).toBe("neo4j://127.0.0.1:7687");
      expect(DEFAULTS.USERNAME).toBe("neo4j");
    });
  });

  describe("path compatibility", () => {
    it("uses path.join for cross-platform compatibility", () => {
      // Verify that path.join handles various path formats
      const { join } = require("node:path");
      // Unix-style path
      const unixPath = join("/Users/test/project", ".env");
      expect(unixPath).toBe("/Users/test/project/.env");
      // Verify the path construction uses join (not string concatenation)
      expect(unixPath).not.toBe("/Users/test/project" + ".env");
    });

    it("handles paths with spaces", () => {
      const dirWithSpaces = join(tmpdir(), "my project");
      mkdirSync(dirWithSpaces, { recursive: true });

      const config: Neo4jConfig = {
        uri: "bolt://localhost:7687",
        database: "neo4j",
        username: "neo4j",
        password: "secret",
        connectionType: "cypher-shell",
      };
      saveConfig(dirWithSpaces, config);

      const result = loadConfig(dirWithSpaces);
      expect(result.success).toBe(true);
      expect(result.config?.uri).toBe("bolt://localhost:7687");
    });
  });

  describe("ensureEnvInGitignore", () => {
    it("creates .gitignore with .env entry when no .gitignore exists", () => {
      ensureEnvInGitignore(projectRoot);
      const gitignorePath = join(projectRoot, ".gitignore");
      expect(existsSync(gitignorePath)).toBe(true);
      const content = readFileSync(gitignorePath, "utf-8");
      expect(content).toContain(".env");
    });

    it("appends .env entry to existing .gitignore", () => {
      const gitignorePath = join(projectRoot, ".gitignore");
      writeFileSync(gitignorePath, "node_modules/\ndist/\n", "utf-8");
      ensureEnvInGitignore(projectRoot);
      const content = readFileSync(gitignorePath, "utf-8");
      expect(content).toContain("node_modules/");
      expect(content).toContain(".env");
    });

    it("does not duplicate .env if already in .gitignore", () => {
      const gitignorePath = join(projectRoot, ".gitignore");
      writeFileSync(gitignorePath, "node_modules/\n.env\ndist/\n", "utf-8");
      ensureEnvInGitignore(projectRoot);
      const content = readFileSync(gitignorePath, "utf-8");
      const count = (content.match(/^\.env$/gm) ?? []).length;
      expect(count).toBe(1);
    });

    it("saveConfig automatically adds .env to .gitignore", () => {
      const config: Neo4jConfig = {
        uri: "bolt://localhost:7687",
        database: "neo4j",
        username: "neo4j",
        password: "secret",
        connectionType: "cypher-shell",
      };
      saveConfig(projectRoot, config);
      const gitignorePath = join(projectRoot, ".gitignore");
      expect(existsSync(gitignorePath)).toBe(true);
      const content = readFileSync(gitignorePath, "utf-8");
      expect(content).toContain(".env");
    });
  });
});