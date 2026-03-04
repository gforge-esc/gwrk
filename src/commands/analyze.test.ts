import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAgent } from "../utils/agent.js";
import { analyzeCommand } from "./analyze.js";

vi.mock("../utils/agent.js", () => ({
  dispatchAgent: vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: "Success",
    stderr: "",
  }),
}));

describe("analyzeCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-analyze-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    // Create .gwrkrc.json
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "test-project" },
        agents: { define: "gemini", implement: "codex-cloud" },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should dispatch agent with correct workflow and feature", async () => {
    await analyzeCommand.parseAsync(["feature-x"], { from: "user" });

    expect(dispatchAgent).toHaveBeenCalledWith({
      backend: "gemini",
      workflowPath: ".agent/workflows/analyze.md",
      featureDir: "specs/feature-x",
    });
  });
});
