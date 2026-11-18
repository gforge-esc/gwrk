/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
  createSyntheticVcsPort,
} from "../../tests/helpers/synthetic-slack.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
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

const { mockSpawn, mockHandleDefineComplete } = vi.hoisted(() => ({
  mockSpawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
  mockHandleDefineComplete: vi.fn(),
}));

// Mock execSync for gh pr merge
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue("Merged PR #42"),
  spawn: mockSpawn,
}));

// Mock PlanStore
vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    handleDefineComplete: mockHandleDefineComplete,
  })),
}));

type SlackActionHandler = (args: any) => Promise<void>;
type SlackEventHandler = (args: any) => Promise<void>;

describe("slack-actions (FR-007, US-004, US-005)", () => {
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

  it.each(["merge_pr", "request_changes"])(
    "refuses project-scoped %s when authorization cannot be resolved",
    async (actionId) => {
      const { execSync } = await import("node:child_process");
      const { findOpenPr } = await import("../db/runs.js");
      await registerSlackActions(mockApp as App, mockContext);
      const ack = vi.fn();
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };
      await actionHandlers[actionId]({
        ack,
        body: {
          team: { id: "W1" },
          channel: { id: "C123" },
          user: { id: "U123" },
          message: { ts: "3.2", thread_ts: "3.1" },
          actions: [
            {
              value: JSON.stringify({
                projectId: "enrolled-project",
                projectSlug: "fixture",
                featureId: "003-slack",
                phaseId: "phase-01",
                rootTs: "3.1",
              }),
            },
          ],
        },
        client: { chat },
        logger: { error: vi.fn() },
      });

      expect(ack).toHaveBeenCalledOnce();
      expect(findOpenPr).not.toHaveBeenCalled();
      expect(execSync).not.toHaveBeenCalled();
      expect(mockContext.queue.enqueue).not.toHaveBeenCalled();
      expect(chat.postMessage).not.toHaveBeenCalled();
    },
  );

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
      "revise_plan",
    ];
    for (const action of expectedActions) {
      expect(mockApp.action).toHaveBeenCalledWith(action, expect.any(Function));
    }
  });

  it("US-004: handles approve_spec action — denies click without routingService", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [
        {
          value: JSON.stringify({
            featureId: "003-slack",
            specPath: "specs/003-slack/spec.md",
          }),
        },
      ],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.approve_spec({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  it("US-004: handles approve_plan action — denies click without routingService", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [
        {
          value: JSON.stringify({
            featureId: "003-slack",
            planPath: "specs/003-slack/plan.md",
          }),
        },
      ],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.approve_plan({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockHandleDefineComplete).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  it("FR-007: handles merge_pr action — denies click without routingService", async () => {
    const { execSync } = await import("node:child_process");
    const { findOpenPr } = await import("../db/runs.js");

    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
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
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.merge_pr({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(findOpenPr).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  it("FR-007: handles retry_phase action — denies click without routingService", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
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
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.retry_phase({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockContext.queue.enqueue).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  it("US-005: handles request_changes action — denies click without routingService", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
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
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.request_changes({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockContext.queue.enqueue).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  it("FR-015: handles revise_spec action — denies click without routingService", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [
        {
          value: JSON.stringify({
            featureId: "003-slack",
          }),
        },
      ],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.revise_spec({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  it("FR-015: handles revise_plan action — denies click without routingService", async () => {
    await registerSlackActions(mockApp as App, mockContext);
    const ack = vi.fn();
    const body = {
      actions: [
        {
          value: JSON.stringify({
            featureId: "003-slack",
          }),
        },
      ],
      channel: { id: "C123" },
      user: { id: "U123" },
    };
    const client = { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } };

    await actionHandlers.revise_plan({
      ack,
      body,
      client,
      logger: console,
    } as any);

    expect(ack).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(client.chat.postEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("unauthorized"),
      }),
    );
  });

  describe("TR-009: click-time re-authorization, thread matching, and replay guards", () => {
    it("unauthorized clicks leave no claim and invoke no side effects", async () => {
      const registry = createSyntheticRegistry();
      const routingService = createProjectRoutingService({ registry });
      const mockVcs = createSyntheticVcsPort();
      const contextWithRouting: CommandContext = {
        ...mockContext,
        routingService,
        vcs: mockVcs,
      };

      await registerSlackActions(mockApp as App, contextWithRouting);
      const ack = vi.fn();
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };

      // Viewer user tries to merge (needs maintainer)
      await actionHandlers.merge_pr({
        ack,
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          channel: { id: SYNTHETIC_CHANNEL_ALPHA },
          user: { id: SYNTHETIC_USER_VIEWER },
          message: {
            ts: "1731320000.000200",
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
          },
          actions: [
            {
              action_id: "merge_pr",
              value: JSON.stringify({
                projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
                projectSlug: SYNTHETIC_PROJECT_ALPHA.slug,
                featureId: SYNTHETIC_THREAD_ALPHA.featureId,
                phaseId: "phase-01",
                rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
              }),
            },
          ],
        },
        client: { chat },
        logger: { error: vi.fn() },
      });

      expect(ack).toHaveBeenCalledOnce();
      expect(mockVcs.mergedPrs).toHaveLength(0);
      expect(chat.postMessage).not.toHaveBeenCalled();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("A higher project role is required"),
        }),
      );

      // Verify no claim was left in the registry!
      const receiptKey = JSON.stringify([
        SYNTHETIC_PROJECT_ALPHA.projectId,
        SYNTHETIC_WORKSPACE_ID,
        SYNTHETIC_CHANNEL_ALPHA,
        "1731320000.000200",
        "merge_pr",
        SYNTHETIC_THREAD_ALPHA.featureId,
        "phase-01",
      ]);
      expect(registry.getActionReceipt(receiptKey)).toBeNull();
    });

    it("thread mismatch denies click and leaves no claim", async () => {
      const registry = createSyntheticRegistry();
      const routingService = createProjectRoutingService({ registry });
      const mockVcs = createSyntheticVcsPort();
      const contextWithRouting: CommandContext = {
        ...mockContext,
        routingService,
        vcs: mockVcs,
      };

      await registerSlackActions(mockApp as App, contextWithRouting);
      const ack = vi.fn();
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };

      // Root timestamp does not match stored thread
      await actionHandlers.merge_pr({
        ack,
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          channel: { id: SYNTHETIC_CHANNEL_ALPHA },
          user: { id: SYNTHETIC_USER_MAINTAINER },
          message: { ts: "1731320000.000200", thread_ts: "wrong-root-ts" },
          actions: [
            {
              action_id: "merge_pr",
              value: JSON.stringify({
                projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
                featureId: SYNTHETIC_THREAD_ALPHA.featureId,
                phaseId: "phase-01",
                rootTs: "wrong-root-ts",
              }),
            },
          ],
        },
        client: { chat },
        logger: { error: vi.fn() },
      });

      expect(mockVcs.mergedPrs).toHaveLength(0);
      expect(chat.postMessage).not.toHaveBeenCalled();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining(
            "does not match the project or feature thread",
          ),
        }),
      );
    });

    it("authorized click merges PR via VcsPort, records receipt, and concurrent replay merges only once", async () => {
      const registry = createSyntheticRegistry();
      const routingService = createProjectRoutingService({ registry });
      const mockVcs = createSyntheticVcsPort();
      const contextWithRouting: CommandContext = {
        ...mockContext,
        routingService,
        vcs: mockVcs,
      };

      await registerSlackActions(mockApp as App, contextWithRouting);
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };

      const clickArgs = {
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          channel: { id: SYNTHETIC_CHANNEL_ALPHA },
          user: { id: SYNTHETIC_USER_MAINTAINER },
          message: {
            ts: "1731320000.000200",
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
          },
          actions: [
            {
              action_id: "merge_pr",
              value: JSON.stringify({
                projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
                projectSlug: SYNTHETIC_PROJECT_ALPHA.slug,
                featureId: SYNTHETIC_THREAD_ALPHA.featureId,
                phaseId: "phase-01",
                rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
              }),
            },
          ],
        },
        client: { chat },
        logger: { error: vi.fn() },
      };

      // First click: succeeds and merges
      await actionHandlers.merge_pr(clickArgs);

      expect(mockVcs.mergedPrs).toHaveLength(1);
      expect(mockVcs.mergedPrs[0].prNumber).toBe(42);
      expect(chat.postMessage).toHaveBeenCalledOnce();

      // Second click (replay): rejected by replay receipt, does not merge again!
      clickArgs.ack.mockClear();
      chat.postMessage.mockClear();

      await actionHandlers.merge_pr(clickArgs);

      expect(mockVcs.mergedPrs).toHaveLength(1); // Still 1!
      expect(chat.postMessage).not.toHaveBeenCalled();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("already has a receipt"),
        }),
      );
    });

    it("two users click view_review on one message and both receive the link without replay rejection", async () => {
      const registry = createSyntheticRegistry();
      const routingService = createProjectRoutingService({ registry });
      const mockVcs = createSyntheticVcsPort();
      const contextWithRouting: CommandContext = {
        ...mockContext,
        routingService,
        vcs: mockVcs,
      };

      await registerSlackActions(mockApp as App, contextWithRouting);
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };

      const baseClick = {
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          channel: { id: SYNTHETIC_CHANNEL_ALPHA },
          user: { id: SYNTHETIC_USER_VIEWER },
          message: {
            ts: "1731320000.000200",
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
          },
          actions: [
            {
              action_id: "view_review",
              value: JSON.stringify({
                projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
                projectSlug: SYNTHETIC_PROJECT_ALPHA.slug,
                featureId: SYNTHETIC_THREAD_ALPHA.featureId,
                phaseId: "phase-01",
                prNumber: 42,
                rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
              }),
            },
          ],
        },
        client: { chat },
        logger: { error: vi.fn() },
      };

      // User 1 (viewer) clicks view_review
      await actionHandlers.view_review(baseClick);
      expect(baseClick.ack).toHaveBeenCalledOnce();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("View full review here"),
        }),
      );

      // User 2 (maintainer) clicks view_review on the exact same message
      const maintainerClick = {
        ...baseClick,
        ack: vi.fn(),
        body: {
          ...baseClick.body,
          user: { id: SYNTHETIC_USER_MAINTAINER },
        },
      };
      chat.postEphemeral.mockClear();

      await actionHandlers.view_review(maintainerClick);
      expect(maintainerClick.ack).toHaveBeenCalledOnce();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("View full review here"),
        }),
      );
    });

    it("a click without routingService runs no side effect", async () => {
      await registerSlackActions(mockApp as App, mockContext);
      const ack = vi.fn();
      const chat = { postMessage: vi.fn(), postEphemeral: vi.fn() };

      await actionHandlers.merge_pr({
        ack,
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          channel: { id: SYNTHETIC_CHANNEL_ALPHA },
          user: { id: SYNTHETIC_USER_MAINTAINER },
          message: {
            ts: "1731320000.000200",
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
          },
          actions: [
            {
              action_id: "merge_pr",
              value: JSON.stringify({
                projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
                projectSlug: SYNTHETIC_PROJECT_ALPHA.slug,
                featureId: SYNTHETIC_THREAD_ALPHA.featureId,
                phaseId: "phase-01",
                rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
              }),
            },
          ],
        },
        client: { chat },
        logger: { error: vi.fn() },
      });

      expect(ack).toHaveBeenCalledOnce();
      expect(chat.postMessage).not.toHaveBeenCalled();
      expect(chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("no routing service available"),
        }),
      );
    });

    it("T017: deliverProjectEvent with void-returning NotificationPort leaves getFeatureThread null", async () => {
      const registry = createSyntheticRegistry();
      const voidNotificationPort = {
        notify: vi.fn().mockResolvedValue(undefined),
      };
      const routingService = createProjectRoutingService({
        registry,
        notificationPort: voidNotificationPort,
      });

      const receipt = await routingService.deliverProjectEvent({
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        featureId: "999-new-feature",
        eventType: "spec_ready",
        message: { text: "Spec ready for review" },
        nowIso: "2026-11-18T10:00:00.000Z",
      });

      expect(receipt.delivered).toBe(false);
      expect(receipt.messageTs).toBeUndefined();
      expect(
        registry.getFeatureThread(
          SYNTHETIC_PROJECT_ALPHA.projectId,
          "999-new-feature",
        ),
      ).toBeNull();
    });
  });
});
