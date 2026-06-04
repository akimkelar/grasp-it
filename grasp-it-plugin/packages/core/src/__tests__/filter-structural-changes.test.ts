import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// grasp-it-plugin/skills/grasp/ -> plugin root is two dirs up from skill
const PLUGIN_ROOT = resolve(__dirname, "../../../..");
const SKILL_DIR = resolve(PLUGIN_ROOT, "skills/grasp");

describe("filter-structural-changes.mjs", () => {
  let tempDir: string;
  let projectRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ua-filter-test-"));
    projectRoot = tempDir;

    // Create .grasp-it/tmp/ directory structure
    mkdirSync(join(projectRoot, ".grasp-it", "tmp"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: write a fingerprints.json baseline.
   */
  function writeFingerprints(files: Record<string, object>) {
    const store = {
      version: "1.0.0" as const,
      gitCommitHash: "abc123",
      generatedAt: "2026-01-01T00:00:00.000Z",
      files,
    };
    writeFileSync(
      join(projectRoot, ".grasp-it", "fingerprints.json"),
      JSON.stringify(store),
      "utf-8",
    );
  }

  /**
   * Helper: write changed-files.txt
   */
  function writeChangedFiles(paths: string[]) {
    writeFileSync(
      join(projectRoot, ".grasp-it", "tmp", "changed-files.txt"),
      paths.join("\n") + "\n",
      "utf-8",
    );
  }

  /**
   * Run the filter script and return { stdout, stderr, exitCode }.
   */
  function runScript() {
    const nodeBin = process.argv[0];
    const scriptPath = resolve(SKILL_DIR, "filter-structural-changes.mjs");
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      stdout = execSync(
        `"${nodeBin}" "${scriptPath}" "${projectRoot}"`,
        {
          cwd: projectRoot,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        },
      ).toString();
    } catch (err: any) {
      stderr = err.stderr?.toString() ?? "";
      exitCode = err.status ?? 1;
    }
    return { stdout, stderr, exitCode };
  }

  /**
   * Helper: read a file that the script should have written.
   * Returns null if the file does not exist.
   */
  function readOutput(name: string): string | null {
    const p = join(projectRoot, ".grasp-it", "tmp", name);
    if (!existsSync(p)) return null;
    return readFileSync(p, "utf-8").trim();
  }

  // ── No fingerprints.json — graceful fallback ─────────────────────────────

  it("falls back to STRUCTURAL when fingerprints.json is missing", () => {
    writeChangedFiles(["src/foo.ts", "src/bar.ts"]);
    const { exitCode, stdout } = runScript();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Fingerprints baseline missing");
    expect(readOutput("structural-changed-files.txt")).toBe("src/foo.ts\nsrc/bar.ts");
    expect(readOutput("cosmetic-only-files.txt")).toBe("");
  });

  // ── No changed-files.txt — graceful exit ──────────────────────────────────

  it("exits cleanly when changed-files.txt does not exist", () => {
    const { exitCode, stdout } = runScript();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No changed files found.");
  });

  it("exits cleanly when changed-files.txt is empty", () => {
    writeFileSync(join(projectRoot, ".grasp-it", "tmp", "changed-files.txt"), "", "utf-8");
    const { exitCode, stdout } = runScript();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No changed files found.");
  });

  // ── Classification with fingerprints.json ────────────────────────────────

  it("classifies a new file as STRUCTURAL", () => {
    // Create the file on disk so analyzeChanges can detect it as a new (not deleted) file
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "new.ts"), "export const x = 1;\n", "utf-8");

    writeFingerprints({});
    writeChangedFiles(["src/new.ts"]);
    const { exitCode, stdout } = runScript();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("STRUCTURAL");
    expect(readOutput("structural-changed-files.txt")).toContain("src/new.ts");
  });

  it("classifies a deleted file as STRUCTURAL", () => {
    writeFingerprints({
      "src/deleted.ts": {
        filePath: "src/deleted.ts",
        contentHash: "deadbeef",
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        totalLines: 10,
        hasStructuralAnalysis: true,
      },
    });
    writeChangedFiles(["src/deleted.ts"]);
    const { exitCode, stdout } = runScript();

    expect(exitCode).toBe(0);
    expect(readOutput("structural-changed-files.txt")).toContain("src/deleted.ts");
    expect(readOutput("cosmetic-only-files.txt")).not.toContain("src/deleted.ts");
  });

  // ── Usage error ───────────────────────────────────────────────────────────

  it("exits with error when no project root is given", () => {
    let exitCode = 0;
    let stderr = "";
    try {
      execSync(
        `"${process.argv[0]}" "${resolve(SKILL_DIR, "filter-structural-changes.mjs")}"`,
        { timeout: 10_000, maxBuffer: 64 * 1024 },
      );
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? "";
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});