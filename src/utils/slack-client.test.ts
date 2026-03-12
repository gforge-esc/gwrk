import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { loadSlackConfig } from "./slack-client";

vi.mock("node:fs");

describe("loadSlackConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    
    // Clear relevant env vars
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null if no tokens are provided", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadSlackConfig();
    expect(config).toBeNull();
  });

  it("should return config if valid tokens are in env", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_APP_TOKEN = "xapp-test";
    
    const config = loadSlackConfig();
    expect(config).toEqual({
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
  });

  it("should fail-fast if tokens are invalid", () => {
    process.env.SLACK_BOT_TOKEN = "invalid-token";
    process.env.SLACK_APP_TOKEN = "xapp-test";
    
    loadSlackConfig();
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Slack configuration error"));
  });

  it("should load tokens from .env file if not in environment", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("SLACK_BOT_TOKEN=xoxb-file\nSLACK_APP_TOKEN=xapp-file");
    
    const config = loadSlackConfig();
    expect(config).toEqual({
      botToken: "xoxb-file",
      appToken: "xapp-file",
    });
  });
});
