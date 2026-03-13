import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setupSlack } from "./setup-slack";
import * as slackClient from "../utils/slack-client";

vi.mock("node:fs");
vi.mock("../utils/slack-client", async () => {
  const actual = await vi.importActual("../utils/slack-client") as any;
  return {
    ...actual,
    verifySlackConfig: vi.fn(),
    loadSlackConfig: vi.fn(),
  };
});

describe("setupSlack", () => {
  const mockEnvPath = path.join(os.tmpdir(), ".gwrk", ".env");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(slackClient, "getEnvPath").mockReturnValue(mockEnvPath);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit called with ${code}`);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should detect already configured slack", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-123",
      appToken: "xapp-123",
    });
    vi.mocked(slackClient.verifySlackConfig).mockResolvedValue({
      workspace: "Gwrk Workspace",
      socketModeOk: true,
    });

    const result = await setupSlack({});

    expect(result.alreadyConfigured).toBe(true);
    expect(console.log).toHaveBeenCalledWith("Slack already configured");
  });

  it("should setup slack when tokens are provided in env", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue(null);
    vi.mocked(slackClient.verifySlackConfig).mockResolvedValue({
      workspace: "Gwrk Workspace",
      socketModeOk: true,
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    process.env.SLACK_BOT_TOKEN = "xoxb-new";
    process.env.SLACK_APP_TOKEN = "xapp-new";

    const result = await setupSlack({});

    expect(result.tokensWritten).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Slack app configured for workspace: Gwrk Workspace"));

    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
  });

  it("should fail if tokens are missing", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue(null);
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;

    await expect(setupSlack({})).rejects.toThrow("process.exit called with 1");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Slack credentials not found"),
    );
  });

  it("should verify existing config when --verify is used", async () => {
    vi.mocked(slackClient.loadSlackConfig).mockReturnValue({
      botToken: "xoxb-existing",
      appToken: "xapp-existing",
    });
    vi.mocked(slackClient.verifySlackConfig).mockResolvedValue({
      workspace: "Gwrk Workspace",
      socketModeOk: true,
    });

    const result = await setupSlack({ verify: true });

    expect(result.socketModeOk).toBe(true);
    expect(console.log).toHaveBeenCalledWith("Socket Mode: OK");
  });
});
