import type {
  App,
  SlackActionMiddlewareArgs,
  SlackEventMiddlewareArgs,
} from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { registerSlackActions } from "./slack-actions.js";
import type { CommandContext } from "./slack-commands.js";

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
  });

  it("handles merge_pr action", async () => {
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
    expect(mockContext.git.mergePhaseBack).toHaveBeenCalledWith(
      "003-slack",
      "phase-01",
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "PR for *003-slack* phase *phase-01* merged",
        ),
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
