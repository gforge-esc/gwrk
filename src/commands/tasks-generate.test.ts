import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tasksGenerateCommand } from "./tasks-generate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";

const { mockWriteManifest } = vi.hoisted(() => ({
  mockWriteManifest: vi.fn(),
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: mockWriteManifest,
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn(() => "mock-commit"),
  getCurrentBranch: vi.fn(() => "mock-branch"),
  getDiffStats: vi.fn(() => ({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 })),
  commitFiles: vi.fn(),
}));

// Mock format.js to avoid messy output
vi.mock("../utils/format.js", () => ({
  banner: vi.fn(),
  blocked: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}));

describe("tasks-generate (Deterministic plan-to-tasks)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-generate-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    
    // Create necessary structure
    const specDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(path.join(specDir, ".gwrk", "runs"), { recursive: true });

    // Create src/ with a test file to satisfy ADR-005 §8.4 guard
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "setup.test.ts"), "// red test stub");
    
    // Create a mock config
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({ project: { name: "test-feature" }, agents: { define: "gemini", implement: "gemini" } }));

    // Create a plan.md with valid format (required by deterministic parser)
    fs.writeFileSync(path.join(specDir, "plan.md"), [
      "# Plan: test-feature",
      "",
      "### Phase 1: Initial Setup",
      "",
      "**Files (2):**",
      "- `src/setup.ts` (NEW: Create the initial setup file with configuration)",
      "- `src/config.ts` (NEW: Create the configuration module)",
      "",
    ].join("\n"));

    mockWriteManifest.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should produce tasks.json from plan.md deterministically", async () => {
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    await program.parseAsync(["node", "test", "tasks", "test-feature"]);
    
    const tasksPath = path.join(tempDir, "specs", "test-feature", ".gwrk", "tasks.json");
    expect(fs.existsSync(tasksPath)).toBe(true);

    const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
    expect(tasks.phases.length).toBeGreaterThanOrEqual(1);
    expect(tasks.phases[0].id).toBe("phase-01");
    expect(tasks.phases[0].tasks.length).toBe(2);
  });

  it("should write execution manifest after success", async () => {
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    await program.parseAsync(["node", "test", "tasks", "test-feature"]);
    
    const featureDir = path.join(tempDir, "specs", "test-feature");
    expect(mockWriteManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define tasks",
        feature: "test-feature",
      })
    );
  });
});
