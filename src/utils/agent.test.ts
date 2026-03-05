import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { dispatchAgent } from "./agent.js";
import { execCommand } from "./exec.js";

vi.mock("./exec.js", () => ({
  execCommand: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue("mock workflow content"),
  },
}));

describe("dispatchAgent", () => {
  it("should build correct command and args for gemini", async () => {
    await dispatchAgent({
      backend: "gemini",
      workflowPath: ".agent/workflows/specify.md",
      prompt: "test feature",
      approvalMode: "yolo",
    });

    expect(execCommand).toHaveBeenCalledWith(
      "gemini",
      ["test feature", "--approve-mode=yolo"],
      "mock workflow content",
    );
  });

  it("should build correct command and args for claude", async () => {
    await dispatchAgent({
      backend: "claude",
      workflowPath: ".agent/workflows/plan.md",
      featureDir: "specs/test-feature",
    });

    expect(execCommand).toHaveBeenCalledWith(
      "claude",
      ["--output-format", "json", "specs/test-feature"],
      "mock workflow content",
    );
  });

  it("should build correct command and args for codex", async () => {
    await dispatchAgent({
      backend: "codex",
      workflowPath: ".agent/workflows/analyze.md",
      featureDir: "specs/test-feature",
    });

    expect(execCommand).toHaveBeenCalledWith(
      "codex",
      [
        "exec",
        "--full-auto",
        ".agent/workflows/analyze.md",
        "specs/test-feature",
      ],
      undefined,
    );
  });

  it("should build correct command and args for codex-cloud", async () => {
    await dispatchAgent({
      backend: "codex-cloud",
      workflowPath: ".agent/workflows/effort.md",
      featureDir: "specs/test-feature",
    });

    expect(execCommand).toHaveBeenCalledWith(
      "codex",
      [
        "run",
        "--cloud",
        "--non-interactive",
        "--full-auto",
        ".agent/workflows/effort.md",
        "specs/test-feature",
      ],
      undefined,
    );
  });
});
