/**
 * Tests for the Claude Code plugin marketplace configuration.
 *
 * These tests verify that:
 * 1. .claude-plugin/marketplace.json exists at the repo root
 * 2. The marketplace.json is valid and has the required structure
 * 3. The plugin's .claude-plugin/plugin.json exists in grasp-it-plugin/
 * 4. The marketplace correctly references the plugin subdirectory
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// From tests/install/, go up 2 levels to reach the repo root
const REPO_ROOT = resolve(__dirname, '../..');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read and parse the marketplace.json at repo root. */
function getMarketplaceJson() {
  const path = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
  if (!existsSync(path)) {
    throw new Error(`marketplace.json not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Read and parse the plugin's plugin.json. */
function getPluginJson() {
  const path = join(REPO_ROOT, 'grasp-it-plugin', '.claude-plugin', 'plugin.json');
  if (!existsSync(path)) {
    throw new Error(`plugin.json not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('marketplace.json at repo root', () => {
  let marketplace;

  beforeAll(() => {
    marketplace = getMarketplaceJson();
  });

  it('marketplace.json exists at .claude-plugin/ in repo root', () => {
    const path = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
    expect(existsSync(path)).toBe(true);
  });

  it('marketplace.json is valid JSON', () => {
    expect(() => getMarketplaceJson()).not.toThrow();
  });

  it('marketplace.json has required top-level fields', () => {
    expect(marketplace).toHaveProperty('name');
    expect(marketplace).toHaveProperty('owner');
    expect(marketplace).toHaveProperty('plugins');
    expect(Array.isArray(marketplace.plugins)).toBe(true);
  });

  it('marketplace.json name is a non-empty string', () => {
    expect(typeof marketplace.name).toBe('string');
    expect(marketplace.name.length).toBeGreaterThan(0);
  });

  it('marketplace.json owner has a name field', () => {
    expect(marketplace.owner).toHaveProperty('name');
    expect(typeof marketplace.owner.name).toBe('string');
  });

  it('marketplace.json has at least one plugin entry', () => {
    expect(marketplace.plugins.length).toBeGreaterThan(0);
  });

  it('plugin entry has required fields (name, source)', () => {
    const plugin = marketplace.plugins[0];
    expect(plugin).toHaveProperty('name');
    expect(plugin).toHaveProperty('source');
    expect(typeof plugin.name).toBe('string');
  });

  it('plugin source uses git-subdir pointing to grasp-it-plugin', () => {
    const plugin = marketplace.plugins[0];
    expect(plugin.source).toHaveProperty('source', 'git-subdir');
    expect(plugin.source).toHaveProperty('url');
    expect(plugin.source.url).toContain('github.com/akimkelar/Grasp-It');
    expect(plugin.source).toHaveProperty('path', 'grasp-it-plugin');
    expect(plugin.source).toHaveProperty('ref', 'main');
  });

  it('marketplace.json plugins[0].name matches the plugin directory name', () => {
    const plugin = marketplace.plugins[0];
    expect(plugin.name).toBe('grasp-it');
  });
});

describe('plugin.json in grasp-it-plugin/', () => {
  let pluginJson;

  beforeAll(() => {
    pluginJson = getPluginJson();
  });

  it('plugin.json exists at grasp-it-plugin/.claude-plugin/', () => {
    const path = join(REPO_ROOT, 'grasp-it-plugin', '.claude-plugin', 'plugin.json');
    expect(existsSync(path)).toBe(true);
  });

  it('plugin.json is valid JSON', () => {
    expect(() => getPluginJson()).not.toThrow();
  });

  it('plugin.json has required fields (name, description)', () => {
    expect(pluginJson).toHaveProperty('name');
    expect(pluginJson).toHaveProperty('description');
    expect(typeof pluginJson.name).toBe('string');
    expect(typeof pluginJson.description).toBe('string');
  });

  it('plugin.json name is "grasp-it"', () => {
    expect(pluginJson.name).toBe('grasp-it');
  });

  it('plugin.json has version field', () => {
    expect(pluginJson).toHaveProperty('version');
  });

  it('plugin.json has author field', () => {
    expect(pluginJson).toHaveProperty('author');
    expect(pluginJson.author).toHaveProperty('name');
  });
});

describe('consistency between marketplace.json and plugin.json', () => {
  let marketplace;
  let pluginJson;

  beforeAll(() => {
    marketplace = getMarketplaceJson();
    pluginJson = getPluginJson();
  });

  it('marketplace plugin name matches plugin.json name', () => {
    expect(marketplace.plugins[0].name).toBe(pluginJson.name);
  });

  it('marketplace uses correct git-subdir path for the plugin', () => {
    const source = marketplace.plugins[0].source;
    expect(source.path).toBe('grasp-it-plugin');
    expect(source.url).toContain('akimkelar/Grasp-It');
  });
});