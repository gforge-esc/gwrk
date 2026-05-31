import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as runs from "../db/runs.js";
import * as plugins from "../db/plugins.js";
import * as exec from "../utils/exec.js";
import * as slackClient from "../utils/slack-client.js";
import * as slackChannel from "../server/slack-channel.js";
import * as seed from "../plugins/seed.js";
import * as migrate from "../plugins/migrate.js";
import { initCommand } from "./init.js";

vi.mock("../utils/slack-client.js", () => ({
  loadSlackConfig: vi.fn(),
  getEnvPath: vi.fn(),
}));

vi.mock("../server/slack-channel.js", () => ({
  ensureSlackChannel: vi.fn(),
}));

vi.mock("../plugins/seed.js", () => ({
  seedSkills: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../plugins/migrate.js", () => ({
  migratePlugins: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/plugins.js", () => ({
  getAgentContextSync: vi.fn(),
  recordAgentContextSync: vi.fn(),
}));

describe("initCommand", () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-home-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(os, "homedir").mockReturnValue(homeDir);
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
    fs.rmSync(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should create scaffold directories, .gwrkrc.json, and register project (US-014)", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    vi.mocked(slackChannel.ensureSlackChannel).mockResolvedValue("C_TEST");

    await initCommand.parseAsync(
      ["--github", "owner/repo", "--slack", "#channel"],
      { from: "user" },
    );

    // Project root scaffolding
    expect(fs.existsSync(path.join(tempDir, ".agents"))).toBe(false); // Should NOT exist
    expect(fs.existsSync(path.join(tempDir, ".specify/templates"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "specs"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);

    // Global provisioning
    expect(fs.existsSync(path.join(homeDir, ".gwrk/plugins/skills"))).toBe(true);
    expect(fs.existsSync(path.join(homeDir, ".gwrk/plugins/workflows"))).toBe(true);
    const wfDir = path.join(homeDir, ".gwrk/plugins/workflows/gwrk-specify");
    expect(fs.existsSync(wfDir)).toBe(true);
    expect(fs.existsSync(path.join(wfDir, "manifest.yaml"))).toBe(true);
    expect(seed.seedSkills).toHaveBeenCalled();
    expect(migrate.migratePlugins).toHaveBeenCalled();

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

  it("should provision GEMINI.md, CLAUDE.md, and .gwrk/agent-context.md if CLIs are detected (FR-L1-008)", async () => {
    vi.mocked(exec.execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === "which" && (args[0] === "gemini" || args[0] === "claude")) {
        return { exitCode: 0, stdout: `/usr/local/bin/${args[0]}`, stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    });

    await initCommand.parseAsync([], { from: "user" });

    expect(fs.existsSync(path.join(tempDir, "GEMINI.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "CLAUDE.md"))).toBe(true);
    
    const contextPath = path.join(tempDir, ".gwrk/agent-context.md");
    expect(fs.existsSync(contextPath)).toBe(true);
    const content = fs.readFileSync(contextPath, "utf-8");
    expect(content).toContain("~/.gwrk/plugins/workflows/");
    expect(content).not.toContain(".agents/rules/");
  });

  it("should be idempotent and exit 0 if already initialized", async () => {
    const gwrkDir = path.join(tempDir, ".gwrk");
    const rcPath = path.join(tempDir, ".gwrkrc.json");
    fs.mkdirSync(gwrkDir);
    fs.writeFileSync(rcPath, "{}");

    process.exitCode = 0;
    await initCommand.parseAsync([], { from: "user" });
    expect(process.exitCode).toBe(0);
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
