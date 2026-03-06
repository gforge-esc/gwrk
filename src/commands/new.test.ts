import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newCommand } from "./new.js";
import * as exec from "../utils/exec.js";
import { initCommand } from "./init.js";

describe("newCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-new-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(exec, "execCommand").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    vi.spyOn(initCommand, "parseAsync").mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should create directory, init git, and delegate to init", async () => {
    const projectName = "test-project";
    const projectPath = path.join(tempDir, projectName);

    await newCommand.parseAsync([projectName], { from: "user" });

    expect(fs.existsSync(projectPath)).toBe(true);
    expect(exec.execCommand).toHaveBeenCalledWith("git", ["init"], undefined, { cwd: projectPath });
    expect(initCommand.parseAsync).toHaveBeenCalledWith([], { from: "user" });
  });

  it("should attempt to create gh repo if requested", async () => {
    const projectName = "test-project";
    const githubRepo = "owner/repo";
    const projectPath = path.join(tempDir, projectName);

    vi.mocked(exec.execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === "which" && args[0] === "gh") {
        return { exitCode: 0, stdout: "/usr/local/bin/gh", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await newCommand.parseAsync([projectName, "--github", githubRepo], { from: "user" });

    expect(initCommand.parseAsync).toHaveBeenCalledWith(["--github", githubRepo], { from: "user" });
  });

  it("should fail if directory already exists", async () => {
    const projectName = "test-project";
    fs.mkdirSync(path.join(tempDir, projectName));

    await expect(() =>
      newCommand.parseAsync([projectName], { from: "user" }),
    ).rejects.toThrow("process.exit(1)");
  });
});
