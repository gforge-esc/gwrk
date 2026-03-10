import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runs from "../db/runs.js";
import * as exec from "../utils/exec.js";
import * as slackClient from "../utils/slack-client.js";
import * as slackChannel from "../server/slack-channel.js";
import { initCommand } from "./init.js";

vi.mock("../utils/slack-client.js", () => ({
  loadSlackConfig: vi.fn(),
  getEnvPath: vi.fn(),
}));

vi.mock("../server/slack-channel.js", () => ({
  ensureSlackChannel: vi.fn(),
}));

describe("initCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(runs, "registerProject").mockImplementation(() => {});
    vi.spyOn(exec, "execCommand").mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue(null);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should create scaffold directories, .gwrkrc.json, and register project", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    vi.mocked(slackChannel.ensureSlackChannel).mockResolvedValue("C_TEST");

    await initCommand.parseAsync(
      ["--github", "owner/repo", "--slack", "#channel"],
      { from: "user" },
    );

    expect(fs.existsSync(path.join(tempDir, ".agent/workflows"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".agent/rules"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".specify/templates"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "specs"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);

    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"),
    );
    expect(config.project.name).toBe(path.basename(tempDir));
    expect(config.project.githubRepo).toBe("owner/repo");
    expect(config.project.slack.channelName).toBe("#channel");
    expect(config.project.slack.channelId).toBe("C_TEST");
    expect(config.agents.define).toBe("gemini");

    expect(runs.registerProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: path.basename(tempDir),
        path: tempDir,
        github_repo: "owner/repo",
        slack_channel: "#channel",
      }),
    );
  });

  it("should provision GEMINI.md if gemini CLI is detected", async () => {
    vi.mocked(exec.execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === "which" && args[0] === "gemini") {
        return { exitCode: 0, stdout: "/usr/local/bin/gemini", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    });

    await initCommand.parseAsync([], { from: "user" });

    expect(fs.existsSync(path.join(tempDir, "GEMINI.md"))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "GEMINI.md"), "utf-8")).toContain(
      "GEMINI Project Context",
    );
  });

  it("should be idempotent and exit 0 if already initialized", async () => {
    const agentDir = path.join(tempDir, ".agent");
    fs.mkdirSync(agentDir);

    // Should throw our mocked error for process.exit(0)
    await expect(() =>
      initCommand.parseAsync([], { from: "user" }),
    ).rejects.toThrow("process.exit(0)");
    expect(console.log).toHaveBeenCalledWith("gwrk already initialized");
  });

  it("should create private GitHub repository if --github is provided and gh is available", async () => {
    vi.mocked(exec.execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === "which" && args[0] === "gh") {
        return { exitCode: 0, stdout: "/usr/local/bin/gh", stderr: "" };
      }
      if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "error: No such remote 'origin'",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const githubRepo = "owner/repo";
    await initCommand.parseAsync(["--github", githubRepo], { from: "user" });

    expect(exec.execCommand).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining([
        "repo",
        "create",
        githubRepo,
        "--private",
        "--source",
        ".",
      ]),
      undefined,
      { cwd: tempDir },
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        `Creating private GitHub repository ${githubRepo}`,
      ),
    );
  });
});
