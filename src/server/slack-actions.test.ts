import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSlackActions } from "./slack-actions.js";
import type { CommandContext } from "./slack-commands.js";

describe("slack-actions", () => {
  let mockApp: any;
  let mockContext: CommandContext;
  let actionHandlers: Record<string, Function> = {};
  let eventHandlers: Record<string, Function> = {};

  beforeEach(() => {
    actionHandlers = {};
    eventHandlers = {};
    mockApp = {
      action: vi.fn((id, handler) => {
        actionHandlers[id] = handler;
      }),
      event: vi.fn((type, handler) => {
        eventHandlers[type] = handler;
      }),
    };
    mockContext = {
      queue: {
        enqueue: vi.fn(),
      } as any,
      monitor: {} as any,
      git: {
        merge: vi.fn(),
        mergePhaseBack: vi.fn(),
      } as any,
      projectRoot: "/tmp",
      buildServerUrl: "http://localhost:3000",
      userId: "U123",
      channelId: "C123",
    };
  });

  it("registers actions", async () => {
    await registerSlackActions(mockApp, mockContext);
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
    await registerSlackActions(mockApp, mockContext);
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

    await actionHandlers["merge_pr"]({ ack, body, client, logger: console });
    expect(ack).toHaveBeenCalled();
    expect(mockContext.git.mergePhaseBack).toHaveBeenCalledWith("003-slack", "phase-01");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("PR for *003-slack* phase *phase-01* merged"),
      }),
    );
  });

  it("registers reaction_added event", async () => {
    await registerSlackActions(mockApp, mockContext);
    expect(mockApp.event).toHaveBeenCalledWith(
      "reaction_added",
      expect.any(Function),
    );
  });
});
