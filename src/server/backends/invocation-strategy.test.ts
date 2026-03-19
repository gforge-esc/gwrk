import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalInvocationStrategy } from "./invocation-strategy.js";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("LocalInvocationStrategy", () => {
  let strategy: LocalInvocationStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new LocalInvocationStrategy();
  });

  it("FR-006, US-005: should invoke gemini cli in the correct workDir", async () => {
    const task = {
      agent: "gemini",
      workDir: "/test/root/.runs/sandboxes/T1",
      prompt: "Fix the bug",
      stdin: "{\"context\": \"...\"}",
    };

    await strategy.invoke(task);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("gemini-cli"),
      expect.objectContaining({
        cwd: task.workDir,
        input: task.stdin,
      })
    );
  });

  it("FR-006, US-005: should invoke claude cli in the correct workDir", async () => {
    const task = {
      agent: "claude",
      workDir: "/test/root/.runs/sandboxes/T2",
      prompt: "Implement the feature",
      stdin: "{\"context\": \"...\"}",
    };

    await strategy.invoke(task);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("claude-cli"),
      expect.objectContaining({
        cwd: task.workDir,
        input: task.stdin,
      })
    );
  });
});
