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

const { mockSpawn, mockUpdateStatus } = vi.hoisted(() => ({
  mockSpawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
  mockUpdateStatus: vi.fn(),
}));

// Mock execSync for gh pr merge
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue("Merged PR #42"),
  spawn: mockSpawn,
}));

// Mock PlanStore
vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    updateStatus: mockUpdateStatus,
  })),
}));

// biome-ignore lint/suspicious/noExplicitAny: complex mock args
type SlackActionHandler = (args: any) => Promise<void>;
// biome-ignore lint/suspicious/noExplicitAny: complex mock args
type SlackEventHandler = (args: any) => Promise<void>;

describe("slack-actions (FR-007, US-004)", () => {
  let mockApp: Partial<App>;
  let mockContext: CommandContext;
  let actionHandlers: Record<string, SlackActionHandler> = {};
  let eventHandlers: Record<string, SlackEventHandler> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReturnValue({ unref: vi.fn() });
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

  it("registers all required actions", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const expectedActions = [
      "merge_pr",
      "request_changes",
      "view_review",
      "retry_phase",
      "approve_spec",
      "approve_plan",
      "revise_spec",
    ];
    for (const action of expectedActions) {
      expect(mockApp.action).toHaveBeenCalledWith(action, expect.any(Function));
    }
  });

  it("US-004: handles approve_spec action — triggers plan generation (TR-015)", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [{ value: JSON.stringify({ featureId: "003-slack", specPath: "specs/003-slack/spec.md" }) }],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn() } };

    await actionHandlers.approve_spec({ ack, body, client, logger: console } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      "gwrk",
      ["plan", "003-slack"],
      expect.objectContaining({ cwd: "/tmp", detached: true }),
    );
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Approved spec"),
      }),
    );
  });

  it("US-004: handles approve_plan action — updates PlanStore to DEFINED (TR-015)", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [{ value: JSON.stringify({ featureId: "003-slack", planPath: "specs/003-slack/plan.md" }) }],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn() } };

    await actionHandlers.approve_plan({ ack, body, client, logger: console } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockUpdateStatus).toHaveBeenCalledWith("003-slack", "DEFINED");
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Approved plan"),
      }),
    );
  });

  it("FR-007: handles merge_pr action — calls gh pr merge", async () => {
    const { execSync } = await import("node:child_process");
    const { findOpenPr } = await import("../db/runs.js");

    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const postMessage = vi.fn();
    const body = {
      actions: [{ value: JSON.stringify({ featureId: "003-slack", phaseId: "phase-01" }) }],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage } };

    await actionHandlers.merge_pr({ ack, body, client, logger: console } as any);

    expect(ack).toHaveBeenCalled();
    expect(findOpenPr).toHaveBeenCalledWith("003-slack", "phase-01");
    expect(execSync).toHaveBeenCalledWith(
      "gh pr merge 42 --merge --delete-branch",
      expect.objectContaining({ cwd: "/tmp" }),
    );
  });

  it("FR-007: handles retry_phase action — re-dispatches via queue", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [{ value: JSON.stringify({ featureId: "003-slack", phaseId: "phase-01" }) }],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn() } };

    await actionHandlers.retry_phase({ ack, body, client, logger: console } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockContext.queue.enqueue).toHaveBeenCalledWith({
      featureId: "003-slack",
      phaseId: "phase-01",
    });
  });
});
