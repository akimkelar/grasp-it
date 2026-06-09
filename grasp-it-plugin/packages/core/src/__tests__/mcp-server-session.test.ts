import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createNeo4jSession } from "../mcp-server/session.js";
import { saveConfig, type Neo4jConfig } from "../neo4j-config.js";

describe("createNeo4jSession", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "session-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function mockNeo4jDriver(mockDriver: {
    session: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }) {
    vi.doMock("neo4j-driver", () => ({
      default: {
        driver: vi.fn().mockReturnValue(mockDriver),
        auth: {
          basic: vi.fn().mockReturnValue({}),
        },
      },
    }));
  }

  describe("success path", () => {
    it("creates session with valid driver config", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [{ foo: "bar" }] }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockDriver = {
        session: vi.fn().mockReturnValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockNeo4jDriver(mockDriver);

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.run).toBeDefined();
      expect(result.session?.close).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify run method calls through to the underlying session
      const runResult = await result.session!.run("MATCH (n) RETURN n", { param: "value" });
      expect(runResult.records).toEqual([{ foo: "bar" }]);
      expect(mockSession.run).toHaveBeenCalledWith("MATCH (n) RETURN n", { param: "value" });
    });

    it("session.run returns records with proper structure", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j+s://abc123.databases.neo4j.io",
        database: "production",
        username: "admin",
        password: "secret-password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      const mockRecords = [{ id: 1 }, { id: 2 }];
      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: mockRecords }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockDriver = {
        session: vi.fn().mockReturnValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockNeo4jDriver(mockDriver);

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(true);
      const wrappedResult = await result.session!.run("MATCH (n) RETURN n", {});
      expect(wrappedResult.records).toBe(mockRecords);
    });
  });

  describe("error path when Neo4j connection fails", () => {
    it("returns error when driver throws during connection", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      vi.doMock("neo4j-driver", () => ({
        default: {
          driver: vi.fn().mockImplementation(() => {
            throw new Error("Connection refused");
          }),
          auth: {
            basic: vi.fn().mockReturnValue({}),
          },
        },
      }));

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
      expect(result.error).toContain("Failed to create Neo4j session");
      expect(result.error).toContain("Connection refused");
    });

    it("propagates error when session.run throws", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      const mockSession = {
        run: vi.fn().mockRejectedValue(new Error("Query failed")),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockDriver = {
        session: vi.fn().mockReturnValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockNeo4jDriver(mockDriver);

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();

      // The wrapped session.run should propagate the underlying error
      await expect(result.session!.run("MATCH (n) RETURN n", {})).rejects.toThrow("Query failed");
    });

    it("returns error when neo4j-driver import fails", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      vi.doMock("neo4j-driver", () => {
        throw new Error("Module not found");
      });

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
      expect(result.error).toContain("Failed to create Neo4j session");
    });
  });

  describe("error path when connection type is unsupported", () => {
    it("returns error for MCP connection type", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "mcp",
      };
      saveConfig(projectRoot, config);

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
      expect(result.error).toBe("MCP connection is not yet supported for MCP server");
    });

    it("returns error for cypher-shell connection type", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "cypher-shell",
      };
      saveConfig(projectRoot, config);

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
      expect(result.error).toBe("cypher-shell connection is not supported for MCP server");
    });
  });

  describe("error path when no config exists", () => {
    it("returns error when no Neo4j configuration is found", async () => {
      // No config file written - using empty temp directory

      const result = await createNeo4jSession(projectRoot);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
      expect(result.error).toBe("No Neo4j configuration found");
    });
  });

  describe("close method", () => {
    it("closes session and driver on close", async () => {
      const config: Neo4jConfig = {
        uri: "neo4j://127.0.0.1:7687",
        database: "grasp",
        username: "neo4j",
        password: "password",
        connectionType: "driver",
      };
      saveConfig(projectRoot, config);

      const mockSession = {
        run: vi.fn().mockResolvedValue({ records: [] }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockDriver = {
        session: vi.fn().mockReturnValue(mockSession),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockNeo4jDriver(mockDriver);

      const result = await createNeo4jSession(projectRoot);
      expect(result.success).toBe(true);

      await result.session!.close();

      expect(mockSession.close).toHaveBeenCalled();
      expect(mockDriver.close).toHaveBeenCalled();
    });
  });
});