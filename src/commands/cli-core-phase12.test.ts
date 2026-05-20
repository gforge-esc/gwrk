import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defineCommand } from "./define.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const { mockExecuteWorkflow, mockLoadConfig, mockResolveFeature } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn().mockResolvedValue({
    summary: "Success",
    intents: [],
    summaries: [],
  }),
  mockLoadConfig: vi.fn().mockReturnValue({
    project: { name: "test-project" },
    agents: {
      define: "gemini",
      implement: "claude",
    },
  }),
  mockResolveFeature: vi.fn().mockImplementation((f) => f),
}));

vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: mockResolveFeature,
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("abc"),
  getCurrentBranch: vi.fn().mockReturnValue("main"),
  getDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

describe("CLI Core Phase 12: Quiet Output Parity (US-026, FR-028)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase12-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Create feature structure
    const featureDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(featureDir, "plan.md"), "# Plan");

    mockExecuteWorkflow.mockClear();
    
    // Use the real defineCommand but mock its dependencies
    program = new Command();
    program.addCommand(defineCommand);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("US-026/FR-028: gwrk define spec SHOULD pass quiet: true", async () => {
    await program.parseAsync(["node", "test", "define", "spec", "test-feature", "Create a spec"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-specify",
      expect.anything(),
      expect.objectContaining({ quiet: true })
    );
  });

  it("US-026/FR-028: gwrk define plan SHOULD pass quiet: true", async () => {
    await program.parseAsync(["node", "test", "define", "plan", "test-feature"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-plan",
      expect.anything(),
      expect.objectContaining({ quiet: true })
    );
  });

  it("US-026/FR-028: gwrk define tasks SHOULD pass quiet: true (for gate authoring)", async () => {
    const featureDir = path.join(tempDir, "specs", "test-feature");
    fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
    fs.writeFileSync(path.join(featureDir, "plan.md"), `
# Plan
### Phase 1: Core
**Files (1):**
- \`file1.ts\`
#### Done When
- \`test -f file1.ts\`
- \`some other check\`
`);

    await program.parseAsync(["node", "test", "define", "tasks", "test-feature", "--force"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-author-gates",
      expect.anything(),
      expect.objectContaining({ quiet: true })
    );
  });

  it("US-026/FR-028: gwrk define tests SHOULD pass quiet: true", async () => {
    mockExecuteWorkflow.mockImplementation(async () => {
      const featureDir = path.join(tempDir, "specs", "test-feature");
      fs.writeFileSync(path.join(featureDir, "gap-matrix.md"), "| AC | Test File |\n");
      return { summary: "Success", intents: [], summaries: [] };
    });

    await program.parseAsync(["node", "test", "define", "tests", "test-feature", "--force"]);

    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      "gwrk-define-tests",
      expect.anything(),
      expect.objectContaining({ quiet: true })
    );
  });
});