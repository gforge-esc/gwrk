import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tasksGenerateCommand } from "./tasks-generate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { writeManifest } from "../utils/manifest.js";

const { mockExecuteWorkflow } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn(),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
  getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
  getDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

// Mock format.js to avoid messy output
vi.mock("../utils/format.js", () => ({
  banner: vi.fn(),
  blocked: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}));

describe("tasks-generate (Phase 9)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-generate-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    
    // Create necessary structure
    const specDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(path.join(specDir, ".gwrk"), { recursive: true });
    fs.mkdirSync(path.join(specDir, "gates"), { recursive: true });
    fs.mkdirSync(path.join(specDir, "contracts"), { recursive: true });
    
    // Create a mock config
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({ project: { name: "test-feature" }, agents: { define: "gemini", implement: "gemini" } }));

    // Create a plan.md that parsePlan can understand
    fs.writeFileSync(path.join(specDir, "plan.md"), `
# Plan: test-feature

### Phase 1: Core
**Files (1):**
- \`file1.ts\` (Description)

#### Test Strategy
Implement test strategy for Phase 1

#### Done When
- \`test -f file1.ts\`
`);
    
    // Create a contract to pass the guard
    fs.writeFileSync(path.join(specDir, "contracts", "file1.md"), "# Contract: file1");
    
    // Create gap-matrix.md
    fs.writeFileSync(path.join(specDir, "gap-matrix.md"), "| AC | Test File |\n|----|-----------|\n");

    mockExecuteWorkflow.mockReset();
    mockExecuteWorkflow.mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-019/FR-019: SHOULD write execution manifest after success (RED)", async () => {
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    await program.parseAsync(["node", "test", "tasks", "test-feature", "--force", "--no-llm"]);
    
    const featureDir = path.join(tempDir, "specs", "test-feature");
    // In RED state, this fails because tasks-generate.ts does NOT call writeManifest yet
    expect(writeManifest).toHaveBeenCalledWith(
      featureDir,
      expect.objectContaining({
        command: "define tasks",
        feature: "test-feature",
      })
    );
  });
});
