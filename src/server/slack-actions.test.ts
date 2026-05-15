/**
 * Module does not exist yet (RED)
 */
import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { registerSlackActions } from "./slack-actions.js";
import type { CommandContext } from "./slack-commands.js";

// Mock findOpenPr
vi.mock("../db/runs.js", () => ({
  findOpenPr: vi.fn().mockReturnValue({
    pr_number: 42,
    pr_url: "https://github.com/test/pr/42",
  }),
}));

// Mock execSync for gh pr merge
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue("Merged PR #42"),
  spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
}));

// biome-ignore lint/suspicious/noExplicitAny: complex mock args
type SlackActionHandler = (args: any) => Promise<void>;
// biome-ignore lint/suspicious/noExplicitAny: complex mock args
type SlackEventHandler = (args: any) => Promise<void>;

describe("slack-actions", () => {
  let mockApp: Partial<App>;
  let mockContext: CommandContext;
  let actionHandlers: Record<string, SlackActionHandler> = {};
  let eventHandlers: Record<string, SlackEventHandler> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    actionHandlers = {};
    eventHandlers = {};
    mockApp = {
      action: vi.fn((id: string | RegExp, handler: SlackActionHandler) => {
        actionHandlers[id.toString()] = handler;
      }),
      event: vi.fn((type: string | RegExp, handler: SlackEventHandler) => {
        eventHandlers[type.toString()] = handler;
      }),
    };
    mockContext = {
      queue: {
        enqueue: vi.fn(),
      } as unknown as DispatchQueue,
      monitor: {} as unknown as SystemMonitor,
      git: {
        merge: vi.fn(),
        mergePhaseBack: vi.fn(),
      } as unknown as GitManager,
      projectRoot: "/tmp",
      buildServerUrl: "http://localhost:3000",
      userId: "U123",
      channelId: "C123",
    };
  });

  it("registers actions", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    expect(mockApp.action).toHaveBeenCalledWith(
      "merge_pr",
      expect.any(Function),
    );
    expect(mockApp.action).toHaveBeenCalledWith(
      "request_changes",
      expect.any(Function),
    );
    expect(mockApp.action).toHaveBeenCalledWith(
      "view_review",
      expect.any(Function),
    );
    expect(mockApp.action).toHaveBeenCalledWith(
      "retry_phase",
      expect.any(Function),
    );
    expect(mockApp.action).toHaveBeenCalledWith(
      "approve_spec",
      expect.any(Function),
    );
    expect(mockApp.action).toHaveBeenCalledWith(
      "approve_plan",
      expect.any(Function),
    );
    expect(mockApp.action).toHaveBeenCalledWith(
      "revise_spec",
      expect.any(Function),
    );
  });

  it("handles approve_spec action — RED (Not implemented)", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [{ value: JSON.stringify({ featureId: "002-build-server" }) }],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn() } };

    await actionHandlers.approve_spec({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Approved spec"),
      }),
    );
  });

  it("handles approve_plan action — RED (Not implemented)", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [{ value: JSON.stringify({ featureId: "002-build-server" }) }],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn() } };

    await actionHandlers.approve_plan({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Approved plan"),
      }),
    );
  });

  it("handles merge_pr action — calls gh pr merge with PR from runs table", async () => {
    const { execSync } = await import("node:child_process");
    const { findOpenPr } = await import("../db/runs.js");

    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const postMessage = vi.fn();
    const postEphemeral = vi.fn();
    const body = {
      actions: [
        {
          value: JSON.stringify({
            featureId: "003-slack",
            phaseId: "phase-01",
          }),
        },
      ],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage, postEphemeral } };

    await actionHandlers.merge_pr({
      ack,
      body,
      client,
      logger: console,
      // biome-ignore lint/suspicious/noExplicitAny: complex mock
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(findOpenPr).toHaveBeenCalledWith("003-slack", "phase-01");
    expect(execSync).toHaveBeenCalledWith(
      "gh pr merge 42 --merge --delete-branch",
      expect.objectContaining({ cwd: "/tmp" }),
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("PR #42"),
      }),
    );
  });

  it("handles merge_pr with no PR found — posts ephemeral error", async () => {
    const { findOpenPr } = await import("../db/runs.js");
    vi.mocked(findOpenPr).mockReturnValue(null);

    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const postMessage = vi.fn();
    const postEphemeral = vi.fn();
    const body = {
      actions: [
        {
          value: JSON.stringify({
            featureId: "999-missing",
            phaseId: "phase-01",
          }),
        },
      ],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage, postEphemeral } };

    await actionHandlers.merge_pr({
      ack,
      body,
      client,
      logger: console,
      // biome-ignore lint/suspicious/noExplicitAny: complex mock
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("No open PR found"),
      }),
    );
  });

  it("registers reaction_added event", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    expect(mockApp.event).toHaveBeenCalledWith(
      "reaction_added",
      expect.any(Function),
    );
  });
});
