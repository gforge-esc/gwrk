import { type Mocked, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { type CommandContext, handleSlashCommand } from "./slack-commands.js";

describe("slack-commands", () => {
  let mockQueue: Mocked<DispatchQueue>;
  let mockMonitor: Mocked<SystemMonitor>;
  let mockGit: Mocked<GitManager>;
  let context: CommandContext;

  beforeEach(() => {
    mockQueue = {
      getQueue: vi.fn().mockReturnValue({
        active: [],
        queued: [],
        throttled: false,
        paused: false,
      }),
      getDispatch: vi.fn(),
      enqueue: vi.fn(),
      pause: vi.fn(),
    } as unknown as Mocked<DispatchQueue>;
    mockMonitor = {
      getResources: vi.fn().mockReturnValue({
        cpuPercent: 10,
        memPercent: 20,
        diskFreeGb: 100,
      }),
    } as unknown as Mocked<SystemMonitor>;
    mockGit = {
      mergePhaseBack: vi.fn(),
    } as unknown as Mocked<GitManager>;

    context = {
      userId: "U123",
      channelId: "C123",
      projectRoot: "/tmp",
      buildServerUrl: "http://localhost:3000",
      queue: mockQueue,
      monitor: mockMonitor,
      git: mockGit,
    };
  });

  it("handles status command without args", async () => {
    const response = await handleSlashCommand("status", context);
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].text.text).toMatch(
      /\*System Resources:\* CPU 10(\.0)?%, MEM 20(\.0)?%/,
    );
  });

  it("handles status command with feature ID", async () => {
    mockQueue.getDispatch.mockReturnValue({
      featureId: "003-slack",
      status: "running",
      phaseId: "phase-04",
    });
    const response = await handleSlashCommand("status 003-slack", context);
    expect(response.blocks[1].text.text).toContain(
      "*Feature 003-slack:* running (phase-04)",
    );
  });

  it("handles dispatch command with feature ID", async () => {
    const response = await handleSlashCommand("dispatch 003-slack", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain(
      "Dispatching feature *003-slack*",
    );
  });

  it("handles approve command", async () => {
    const response = await handleSlashCommand(
      "approve 003-slack phase-01",
      context,
    );
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain(
      "*003-slack* phase *phase-01* approved and merged",
    );
  });

  it("handles pause command without args", async () => {
    const response = await handleSlashCommand("pause", context);
    expect(mockQueue.pause).toHaveBeenCalled();
    expect(response.blocks[0].text.text).toContain("Dispatch queue paused");
  });

  it("returns help for empty command", async () => {
    const response = await handleSlashCommand("", context);
    expect(response.blocks[0].text.text).toContain("Available commands");
  });

  it("returns error for unknown command", async () => {
    const response = await handleSlashCommand("unknown", context);
    expect(response.blocks[0].text.text).toContain(
      "Unknown subcommand: `unknown`",
    );
  });
});
