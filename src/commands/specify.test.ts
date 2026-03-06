import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAgent } from "../utils/agent.js";
import { specifyCommand } from "./specify.js";

vi.mock("../utils/agent.js", () => ({
  dispatchAgent: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stdout: "Success", stderr: "" }),
}));

describe("specifyCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-specify-test-"));
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
        server: {
          port: 18790,
          host: "localhost",
        },
        parallelism: {
          local: {
            maxCpu: 80,
            maxMem: 80,
            minDiskGb: 10,
            maxClones: 2,
          },
          cloud: {
            maxConcurrent: 10,
          },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should dispatch agent with correct workflow and prompt", async () => {
    await specifyCommand.parseAsync(["new feature"], { from: "user" });

    expect(dispatchAgent).toHaveBeenCalledWith({
      backend: "gemini",
      workflowPath: ".agent/workflows/specify.md",
      prompt: "new feature",
    });
  });

  it("should exit with non-zero if agent fails", async () => {
    vi.mocked(dispatchAgent).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "Error",
    });

    await expect(() =>
      specifyCommand.parseAsync(["new feature"], { from: "user" }),
    ).rejects.toThrow("process.exit(1)");
  });
});
