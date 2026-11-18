/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_ROLES,
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
  createSyntheticVcsPort,
} from "../../tests/helpers/synthetic-slack.js";
import { resolveProjectId } from "../adapters/git/index.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { buildActionReceiptKey } from "../domain/project-registry.js";
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

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
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
      "view_logs",
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

    const messageTs = "1731320000.000200";
    const actionValue = {
      projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
      featureId: SYNTHETIC_THREAD_ALPHA.featureId,
      phaseId: "phase-01",
      rootTs: SYNTHETIC_THREAD_ALPHA.rootTs,
      prNumber: 42,
    };

    function clickArgs(
      actionId: string,
      projectId = actionValue.projectId,
      user = SYNTHETIC_USER_MAINTAINER,
    ) {
      return {
        ack: vi.fn(),
        body: {
          type: "block_actions",
          team: { id: SYNTHETIC_WORKSPACE_ID },
          channel: { id: SYNTHETIC_CHANNEL_ALPHA },
          user: { id: user },
          message: { ts: messageTs, thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs },
          actions: [
            {
              type: "button",
              action_id: actionId,
              value: JSON.stringify({ ...actionValue, projectId }),
            },
          ],
        },
        client: { chat: { postMessage: vi.fn(), postEphemeral: vi.fn() } },
        logger: { error: vi.fn() },
      };
    }

    it.each(["merge_pr", "view_review"])(
      "matches the active thread before looking up the foreign project for %s",
      async (actionId) => {
        const registry = createSyntheticRegistry({
          projects: [
            SYNTHETIC_PROJECT_ALPHA,
            {
              ...SYNTHETIC_PROJECT_BETA,
              slack: {
                ...SYNTHETIC_PROJECT_BETA.slack!,
                workspaceId: "T_OTHER",
              },
            },
          ],
          threads: [
            SYNTHETIC_THREAD_ALPHA,
            {
              ...SYNTHETIC_THREAD_ALPHA,
              projectId: SYNTHETIC_PROJECT_BETA.projectId,
              workspaceId: "T_OTHER",
              channelId: "C_BETA",
              rootTs: "1731320010.000100",
            },
          ],
        });
        const vcs = createSyntheticVcsPort();
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
          vcs,
        });
        const click = clickArgs(actionId, SYNTHETIC_PROJECT_BETA.projectId);

        await actionHandlers[actionId](click);

        expect(click.logger.error).toHaveBeenCalledWith(
          expect.stringContaining("THREAD_PROJECT_MISMATCH"),
        );
        expect(vcs.mergedPrs).toHaveLength(0);
      },
    );

    function createSqliteRegistry() {
      const registry = createSqliteProjectRegistryAdapter({
        dbPath: ":memory:",
      });
      const localRoot = mkdtempSync(join(tmpdir(), "gwrk-slack-registry-"));
      onTestFinished(() => {
        registry.close();
        rmSync(localRoot, { recursive: true, force: true });
      });
      const gitOptions = {
        cwd: localRoot,
        stdio: "ignore" as const,
        timeout: 5_000,
      };
      execFileSync("git", ["init", "--quiet"], gitOptions);
      execFileSync(
        "git",
        ["remote", "add", "origin", "https://github.com/org/alpha.git"],
        gitOptions,
      );
      const project = registry.enrollProject({
        ...SYNTHETIC_PROJECT_ALPHA,
        projectId: resolveProjectId(localRoot),
        localRoot,
        legacyProjectIds: [],
      });
      for (const role of SYNTHETIC_ROLES) {
        if (role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId)
          registry.setRoleBinding({ ...role, projectId: project.projectId });
      }
      registry.bindFeatureThread({
        ...SYNTHETIC_THREAD_ALPHA,
        projectId: project.projectId,
      });
      return { registry, project };
    }

    it("serializes slug and canonical deliveries on one feature thread", async () => {
      const { registry, project } = createSqliteRegistry();
      const givenTs = "1731320000.000300";
      const notify = vi
        .fn()
        .mockResolvedValue({ delivered: true, messageTs: givenTs });
      const routingService = createProjectRoutingService({
        registry,
        notificationPort: { notify },
      });
      const event = {
        featureId: "999-new",
        eventType: "review_ready",
        message: { text: "Ready for review" },
        nowIso: "2026-11-18T10:00:00.000Z",
      };
      await Promise.all([
        routingService.deliverProjectEvent({
          ...event,
          projectId: project.slug,
        }),
        routingService.deliverProjectEvent({
          ...event,
          projectId: project.projectId,
        }),
      ]);

      expect(
        registry.getFeatureThread(project.projectId, event.featureId)?.rootTs,
      ).toBe(givenTs);
      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          projectId: project.projectId,
          threadTs: givenTs,
        }),
      );
    });

    it("reads the authorized project's logs for multiple actors without claiming the button", async () => {
      const root = mkdtempSync(join(tmpdir(), "gwrk-view-logs-"));
      try {
        const runs = join(
          root,
          "specs",
          actionValue.featureId,
          ".gwrk",
          "runs",
        );
        mkdirSync(runs, { recursive: true });
        writeFileSync(
          join(runs, "phase-01.json"),
          JSON.stringify({ exit_code: 0, gate_result: "project alpha gate" }),
        );
        const registry = createSyntheticRegistry({
          projects: [
            { ...SYNTHETIC_PROJECT_ALPHA, localRoot: root },
            SYNTHETIC_PROJECT_BETA,
          ],
        });
        const claim = vi.spyOn(registry, "claimActionReceipt");
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
        });

        for (const user of [SYNTHETIC_USER_VIEWER, SYNTHETIC_USER_MAINTAINER]) {
          const click = clickArgs("view_logs", actionValue.projectId, user);
          await actionHandlers.view_logs(click);
          expect(click.ack).toHaveBeenCalledOnce();
          expect(click.client.chat.postEphemeral).toHaveBeenCalledWith(
            expect.objectContaining({
              user,
              thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
              blocks: expect.arrayContaining([
                expect.objectContaining({
                  text: expect.objectContaining({
                    text: expect.stringContaining("project alpha gate"),
                  }),
                }),
              ]),
            }),
          );
        }
        expect(claim).not.toHaveBeenCalled();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("reports no open PR when the VCS port returns no URL", async () => {
      const { execSync } = await import("node:child_process");
      const vcs = createSyntheticVcsPort();
      vi.spyOn(vcs, "resolvePullRequestUrl").mockResolvedValue(null);
      await registerSlackActions(mockApp as App, {
        ...mockContext,
        routingService: createProjectRoutingService({
          registry: createSyntheticRegistry(),
        }),
        vcs,
      });
      const click = clickArgs("view_review");

      await actionHandlers.view_review(click);

      expect(vcs.resolvePullRequestUrl).toHaveBeenCalledWith(
        SYNTHETIC_PROJECT_ALPHA.localRoot,
        {
          prNumber: 42,
          headBranch: "feat/003-slack",
        },
      );
      expect(execSync).not.toHaveBeenCalled();
      expect(click.client.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("No open PR found"),
        }),
      );
    });

    function reactionArgs(projectId: string) {
      return {
        event: {
          type: "reaction_added",
          item_user: "U_GWRK_BOT",
          user: SYNTHETIC_USER_MAINTAINER,
          reaction: "white_check_mark",
          item: {
            type: "message",
            channel: SYNTHETIC_CHANNEL_ALPHA,
            ts: messageTs,
          },
          event_ts: "1731320000.000400",
        },
        body: { type: "event_callback", team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        client: {
          chat: { postMessage: vi.fn(), postEphemeral: vi.fn() },
          reactions: {
            get: vi.fn().mockResolvedValue({
              message: {
                ts: messageTs,
                text: "Review Ready",
                thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
                blocks: [
                  {
                    type: "actions",
                    elements: [
                      {
                        type: "button",
                        action_id: "merge_pr",
                        value: JSON.stringify({ ...actionValue, projectId }),
                      },
                    ],
                  },
                ],
              },
            }),
          },
        },
        logger: { error: vi.fn() },
      };
    }

    it("marks a failed reaction merge and grants one claim when retried", async () => {
      const { registry, project } = createSqliteRegistry();
      const vcs = createSyntheticVcsPort();
      const merge = vi
        .spyOn(vcs, "mergePullRequest")
        .mockRejectedValueOnce(new Error("merge failed"));
      await registerSlackActions(mockApp as App, {
        ...mockContext,
        routingService: createProjectRoutingService({ registry }),
        vcs,
      });
      const reaction = reactionArgs(project.projectId);
      const receiptKey = buildActionReceiptKey({
        ...actionValue,
        projectId: project.projectId,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        messageTs,
        actionId: "merge_pr",
      });

      await eventHandlers.reaction_added(reaction);

      expect(merge).toHaveBeenCalledOnce();
      expect(registry.getActionReceipt(receiptKey)?.outcome).toBe("failed");
      expect(reaction.client.chat.postMessage).not.toHaveBeenCalled();

      await eventHandlers.reaction_added({
        ...reaction,
        context: { retryNum: 1 },
      });
      expect(merge).toHaveBeenCalledOnce();

      const retry = {
        ...reaction,
        event: { ...reaction.event, event_ts: "1731320000.000500" },
      };
      await Promise.all([
        eventHandlers.reaction_added(retry),
        eventHandlers.reaction_added(retry),
      ]);
      await eventHandlers.reaction_added(retry);

      expect(merge).toHaveBeenCalledTimes(2);
      expect(merge).toHaveBeenLastCalledWith(project.localRoot, 42);
      expect(reaction.client.chat.postMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          channel: SYNTHETIC_CHANNEL_ALPHA,
          thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
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
