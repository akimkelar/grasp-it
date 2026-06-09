#!/usr/bin/env node
/**
 * neo4j-config-loader.mjs
 *
 * Shared Neo4j configuration loader for the .mjs skill scripts.
 * Implements the three-level priority:
 * 1. Environment variables
 * 2. <projectRoot>/.env
 * 3. ~/.grasp-it/neo4j.env
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const GLOBAL_CONFIG_DIR = ".grasp-it";
const GLOBAL_CONFIG_FILE = "neo4j.env";

/**
 * Parse a .env file content and return key-value pairs.
 */
function parseEnvFile(content) {
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Try to get Neo4j config from environment or .env file.
 * Implements three-level priority: env vars -> <projectRoot>/.env -> ~/.grasp-it/neo4j.env
 *
 * @param {string} projectRoot - The project root directory
 * @returns {{ NEO4J_URI: string, NEO4J_USERNAME: string, NEO4J_PASSWORD: string, NEO4J_DATABASE: string } | null}
 */
export function getNeo4jConfig(projectRoot) {
  // TEST MOCK: If CHECK_SYNC_MOCK_NEO4J_COMMIT is set, return a minimal config
  // so the Neo4j query path is entered (loadNeo4jCommit reads the mock env var).
  if (process.env.CHECK_SYNC_MOCK_NEO4J_COMMIT !== undefined) {
    return {
      NEO4J_URI: process.env.NEO4J_URI || "neo4j://localhost:7687",
      NEO4J_USERNAME: process.env.NEO4J_USERNAME || "neo4j",
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "password",
      NEO4J_DATABASE: process.env.NEO4J_DATABASE || "grasp",
    };
  }

  // 1. Check environment variables first
  if (process.env.NEO4J_URI && process.env.NEO4J_USERNAME) {
    return {
      NEO4J_URI: process.env.NEO4J_URI,
      NEO4J_USERNAME: process.env.NEO4J_USERNAME,
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD || "password",
      NEO4J_DATABASE: process.env.NEO4J_DATABASE || "grasp",
    };
  }

  // 2. Try .env in project root
  if (projectRoot) {
    const projectEnvPath = join(projectRoot, ".env");
    if (existsSync(projectEnvPath)) {
      try {
        const content = readFileSync(projectEnvPath, "utf-8");
        const config = parseEnvFile(content);
        if (config.NEO4J_URI && config.NEO4J_USERNAME) {
          return {
            NEO4J_URI: config.NEO4J_URI,
            NEO4J_USERNAME: config.NEO4J_USERNAME,
            NEO4J_PASSWORD: config.NEO4J_PASSWORD || "password",
            NEO4J_DATABASE: config.NEO4J_DATABASE || "grasp",
          };
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. Try global config ~/.grasp-it/neo4j.env
  const globalConfigPath = join(homedir(), GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE);
  if (existsSync(globalConfigPath)) {
    try {
      const content = readFileSync(globalConfigPath, "utf-8");
      const config = parseEnvFile(content);
      if (config.NEO4J_URI && config.NEO4J_USERNAME) {
        return {
          NEO4J_URI: config.NEO4J_URI,
          NEO4J_USERNAME: config.NEO4J_USERNAME,
          NEO4J_PASSWORD: config.NEO4J_PASSWORD || "password",
          NEO4J_DATABASE: config.NEO4J_DATABASE || "grasp",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Get the connection type from environment variable or default to "driver".
 */
export function getConnectionType() {
  return process.env.NEO4J_CONNECTION_TYPE || "driver";
}