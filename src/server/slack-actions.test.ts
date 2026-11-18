/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "@slack/bolt";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_CHANNEL_BETA,
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
import {
  createGitVcsAdapter,
  resolveProjectId,
} from "../adapters/git/index.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { findOpenPr } from "../db/runs.js";
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
    mockSpawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
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
                prNumber: 42,
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
          channel: SYNTHETIC_CHANNEL_ALPHA,
          user: expect.any(String),
          thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
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
          channel: SYNTHETIC_CHANNEL_ALPHA,
          user: expect.any(String),
          thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
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

    it("uses current enrollment when a queued feature delivery acquires its lock", async () => {
      const { registry, project } = createSqliteRegistry();
      let current = project;
      vi.spyOn(registry, "getProject").mockImplementation(() => current);
      let release: (() => void) | undefined;
      const notify = vi
        .fn()
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { delivered: false };
        })
        .mockResolvedValue({ delivered: false });
      const service = createProjectRoutingService({
        registry,
        notificationPort: { notify },
      });
      const event = {
        projectId: project.projectId,
        featureId: "999-queued",
        eventType: "review_ready",
        message: { text: "Review" },
        nowIso: "2026-11-18T10:00:00Z",
      };
      const first = service.deliverProjectEvent(event);
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
      const second = service.deliverProjectEvent(event);
      current = {
        ...project,
        slack: { ...project.slack!, channelId: "C_MOVED" },
      };
      release!();
      await Promise.all([first, second]);
      expect(notify.mock.calls.map(([payload]) => payload.channel)).toEqual([
        SYNTHETIC_CHANNEL_ALPHA,
        "C_MOVED",
      ]);
    });

    it("serializes slug and canonical deliveries on one feature thread", async () => {
      const { registry, project } = createSqliteRegistry();
      const bind = vi.spyOn(registry, "bindFeatureThread");
      const givenTs = "1731320000.000300";
      const notify = vi
        .fn()
        .mockResolvedValueOnce({
          delivered: true,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
          messageTs: givenTs,
        })
        .mockResolvedValueOnce({
          delivered: true,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
          messageTs: "1731320000.000400",
          threadTs: givenTs,
        });
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
      expect(bind).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          projectId: project.projectId,
          threadTs: givenTs,
        }),
      );
    });

    it.each([
      {
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        messageTs: "2026-11-18T10:00:00.000Z",
      },
      {
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        threadTs: SYNTHETIC_THREAD_ALPHA.rootTs,
      },
      { channelId: SYNTHETIC_CHANNEL_BETA },
      { channelId: undefined },
    ])(
      "leaves the feature unbound for receipt metadata %j",
      async (metadata) => {
        const registry = createSyntheticRegistry();
        const bind = vi.spyOn(registry, "bindFeatureThread");
        const receipt = { delivered: true, messageTs, ...metadata };
        const routingService = createProjectRoutingService({
          registry,
          notificationPort: { notify: vi.fn().mockResolvedValue(receipt) },
        });
        const projectId = SYNTHETIC_PROJECT_ALPHA.projectId;
        const featureId = "999-new";

        expect(
          await routingService.deliverProjectEvent({
            projectId,
            featureId,
            eventType: "review_ready",
            message: { text: "Ready for review" },
            nowIso: "2026-11-18T10:00:00.000Z",
          }),
        ).toEqual(receipt);
        expect(bind).not.toHaveBeenCalled();
        expect(registry.getFeatureThread(projectId, featureId)).toBeNull();
      },
    );

    it.each([null, "C_OPS"])(
      "routes operations events using only the enrolled operations channel %s",
      async (opsChannelId) => {
        const project = {
          ...SYNTHETIC_PROJECT_ALPHA,
          slack: { ...SYNTHETIC_PROJECT_ALPHA.slack!, opsChannelId },
        };
        const registry = createSyntheticRegistry({ projects: [project] });
        const bind = vi.spyOn(registry, "bindFeatureThread");
        const notify = vi.fn().mockResolvedValue({
          delivered: true,
          channelId: opsChannelId,
          messageTs,
        });
        const routing = createProjectRoutingService({
          registry,
          notificationPort: { notify },
        });

        const receipt = await routing.deliverProjectEvent({
          projectId: project.projectId,
          featureId: SYNTHETIC_THREAD_ALPHA.featureId,
          eventType: "health",
          opsOnly: true,
          message: { text: "Operations event" },
          nowIso: "2026-11-18T10:00:00.000Z",
        });

        if (opsChannelId) {
          expect(receipt.delivered).toBe(true);
          expect(notify).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              channel: opsChannelId,
              recipient: expect.objectContaining({ channelId: opsChannelId }),
              opsOnly: true,
            }),
          );
          expect(notify.mock.calls[0][0].threadTs).toBeUndefined();
        } else {
          expect(receipt).toEqual({ delivered: false });
          expect(notify).not.toHaveBeenCalled();
        }
        expect(bind).not.toHaveBeenCalled();
      },
    );

    it.each(["retry_phase", "request_changes"])(
      "denies %s on Beta’s thread before claiming or using Alpha’s queue",
      async (actionId) => {
        const { project: alpha } = createSqliteRegistry();
        mkdirSync(join(alpha.localRoot, "specs", actionValue.featureId), {
          recursive: true,
        });
        const alphaThread = {
          ...SYNTHETIC_THREAD_ALPHA,
          projectId: alpha.projectId,
        };
        const betaThread = {
          ...SYNTHETIC_THREAD_ALPHA,
          projectId: SYNTHETIC_PROJECT_BETA.projectId,
          channelId: SYNTHETIC_CHANNEL_BETA,
          rootTs: "1731320010.000100",
        };
        const registry = createSyntheticRegistry({
          projects: [alpha, SYNTHETIC_PROJECT_BETA],
          roles: SYNTHETIC_ROLES.map((role) =>
            role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId
              ? { ...role, projectId: alpha.projectId }
              : role,
          ),
          threads: [alphaThread, betaThread],
        });
        const claim = vi.spyOn(registry, "claimActionReceipt");
        const queueContext = {
          ...mockContext,
          projectRoot: alpha.localRoot,
          queueProjectId: alpha.projectId,
          routingService: createProjectRoutingService({ registry }),
        };
        await registerSlackActions(mockApp as App, queueContext);
        const click = clickArgs(actionId, betaThread.projectId);
        click.body.channel.id = betaThread.channelId;
        click.body.message.thread_ts = betaThread.rootTs;
        click.body.actions[0].value = JSON.stringify({
          ...actionValue,
          projectId: betaThread.projectId,
          rootTs: betaThread.rootTs,
        });

        await actionHandlers[actionId](click);

        expect(click.ack).toHaveBeenCalledOnce();
        expect(click.client.chat.postEphemeral).toHaveBeenCalledWith(
          expect.objectContaining({ text: expect.stringContaining("queue") }),
        );
        expect(claim).not.toHaveBeenCalled();
        expect(mockContext.queue.enqueue).not.toHaveBeenCalled();
        expect(click.client.chat.postMessage).not.toHaveBeenCalled();

        await actionHandlers[actionId](clickArgs(actionId, alpha.projectId));
        expect(claim).toHaveBeenCalledOnce();
        expect(mockContext.queue.enqueue).toHaveBeenCalledOnce();
      },
    );

    it("reads the authorized project's logs for multiple actors without claiming the button", async () => {
      const { project, registry } = createSqliteRegistry();
      const root = project.localRoot;
      const runs = join(root, "specs", actionValue.featureId, ".gwrk", "runs");
      mkdirSync(runs, { recursive: true });
      writeFileSync(
        join(runs, "phase-01.json"),
        JSON.stringify({ exit_code: 0, gate_result: "project alpha gate" }),
      );
      const claim = vi.spyOn(registry, "claimActionReceipt");
      await registerSlackActions(mockApp as App, {
        ...mockContext,
        routingService: createProjectRoutingService({ registry }),
      });

      for (const user of [SYNTHETIC_USER_VIEWER, SYNTHETIC_USER_MAINTAINER]) {
        const click = clickArgs("view_logs", project.projectId, user);
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
      const unbound = clickArgs("view_logs", project.projectId, "U_UNBOUND");
      await actionHandlers.view_logs(unbound);
      expect(unbound.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("UNAUTHORIZED_USER"),
      );
      expect(unbound.client.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Action unauthorized"),
        }),
      );
      expect(claim).not.toHaveBeenCalled();
    });

    it.each(["missing", "linked"])(
      "keeps View Logs on the bound feature when its directory is %s",
      async (directory) => {
        const { project, registry } = createSqliteRegistry();
        const followup = join(
          project.localRoot,
          "specs",
          `${actionValue.featureId}-followup`,
        );
        const runs = join(followup, ".gwrk", "runs");
        mkdirSync(runs, { recursive: true });
        writeFileSync(
          join(runs, `${actionValue.phaseId}.json`),
          JSON.stringify({ gate_result: "follow-up feature gate" }),
        );
        if (directory === "linked") {
          symlinkSync(
            followup,
            join(project.localRoot, "specs", actionValue.featureId),
            "dir",
          );
        }
        const claim = vi.spyOn(registry, "claimActionReceipt");
        const complete = vi.spyOn(registry, "completeActionReceipt");
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
        });
        const click = clickArgs(
          "view_logs",
          project.projectId,
          SYNTHETIC_USER_VIEWER,
        );

        await actionHandlers.view_logs(click);

        expect
          .soft(click.client.chat.postEphemeral)
          .toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              channel: SYNTHETIC_CHANNEL_ALPHA,
              user: SYNTHETIC_USER_VIEWER,
              thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
            }),
          );
        const reply = JSON.stringify(
          click.client.chat.postEphemeral.mock.calls,
        );
        expect.soft(reply).toContain("No ship run logs found");
        expect.soft(reply).not.toContain("follow-up feature gate");
        expect.soft(click.client.chat.postMessage).not.toHaveBeenCalled();
        expect.soft(claim).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["revise_spec", ["define", "spec", actionValue.featureId]],
      ["revise_plan", ["define", "plan", actionValue.featureId]],
      ["approve_spec", ["define", "plan", actionValue.featureId]],
      ["retry_phase", null],
      ["request_changes", null],
    ] as const)(
      "blocks logs and %s in a replaced checkout and allows one action after restoration",
      async (actionId, command) => {
        const { project, registry } = createSqliteRegistry();
        const alpha = project.localRoot;
        const root = mkdtempSync(join(tmpdir(), "gwrk-action-replacement-"));
        onTestFinished(() => rmSync(root, { recursive: true, force: true }));
        const beta = join(root, "beta");
        const savedAlpha = join(root, "alpha");
        for (const [checkout, gate] of [
          [alpha, "Alpha restored gate"],
          [beta, "Beta private gate"],
        ]) {
          const runs = join(
            checkout,
            "specs",
            actionValue.featureId,
            ".gwrk",
            "runs",
          );
          mkdirSync(runs, { recursive: true });
          writeFileSync(
            join(runs, "phase-01.json"),
            JSON.stringify({ gate_result: gate }),
          );
        }
        const gitOptions = {
          cwd: beta,
          stdio: "ignore" as const,
          timeout: 5_000,
        };
        execFileSync("git", ["init", "--quiet"], gitOptions);
        execFileSync(
          "git",
          ["remote", "add", "origin", "https://github.com/org/beta.git"],
          gitOptions,
        );
        const claim = vi.spyOn(registry, "claimActionReceipt");
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          projectRoot: alpha,
          queueProjectId: project.projectId,
          routingService: createProjectRoutingService({ registry }),
        });

        renameSync(alpha, savedAlpha);
        renameSync(beta, alpha);
        const logs = clickArgs("view_logs", project.projectId);
        await actionHandlers.view_logs(logs);
        expect.soft(logs.client.chat.postEphemeral).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining("checkout is unavailable"),
          }),
        );
        expect
          .soft(JSON.stringify(logs.client.chat.postEphemeral.mock.calls))
          .not.toContain("Beta private gate");

        const denied = clickArgs(actionId, project.projectId);
        await actionHandlers[actionId](denied);
        expect.soft(denied.client.chat.postEphemeral).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining("checkout is unavailable"),
          }),
        );
        expect.soft(claim).not.toHaveBeenCalled();
        expect.soft(mockSpawn).not.toHaveBeenCalled();
        expect.soft(mockContext.queue.enqueue).not.toHaveBeenCalled();

        renameSync(alpha, beta);
        renameSync(savedAlpha, alpha);
        const restoredLogs = clickArgs("view_logs", project.projectId);
        await actionHandlers.view_logs(restoredLogs);
        expect
          .soft(
            JSON.stringify(restoredLogs.client.chat.postEphemeral.mock.calls),
          )
          .toContain("Alpha restored gate");
        await Promise.all([
          actionHandlers[actionId](clickArgs(actionId, project.projectId)),
          actionHandlers[actionId](clickArgs(actionId, project.projectId)),
        ]);
        const successfulClaims = claim.mock.results.filter(
          ({ value }) => value === true,
        );
        expect.soft(successfulClaims).toHaveLength(1);
        const receiptKey = buildActionReceiptKey({
          ...actionValue,
          projectId: project.projectId,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
          messageTs,
          actionId,
        });
        expect
          .soft(registry.getActionReceipt(receiptKey)?.outcome)
          .toBe("executed");
        if (command) {
          expect(mockSpawn).toHaveBeenCalledExactlyOnceWith("gwrk", command, {
            cwd: realpathSync(alpha),
            detached: true,
            stdio: "ignore",
          });
          expect(mockContext.queue.enqueue).not.toHaveBeenCalled();
        } else {
          expect(mockContext.queue.enqueue).toHaveBeenCalledExactlyOnceWith({
            featureId: actionValue.featureId,
            phaseId: actionValue.phaseId,
          });
          expect(mockSpawn).not.toHaveBeenCalled();
        }
      },
    );

    it.each([
      "approve_spec",
      "revise_spec",
      "revise_plan",
      "retry_phase",
      "request_changes",
    ])(
      "denies %s before claiming when the feature links outside the enrolled checkout",
      async (actionId) => {
        const { project, registry } = createSqliteRegistry();
        const outsideFeature = mkdtempSync(join(tmpdir(), "gwrk-feature-"));
        onTestFinished(() =>
          rmSync(outsideFeature, { recursive: true, force: true }),
        );
        const specs = join(project.localRoot, "specs");
        mkdirSync(specs);
        symlinkSync(outsideFeature, join(specs, actionValue.featureId), "dir");
        const claim = vi.spyOn(registry, "claimActionReceipt");
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          projectRoot: project.localRoot,
          queueProjectId: project.projectId,
          routingService: createProjectRoutingService({ registry }),
        });
        const click = clickArgs(actionId, project.projectId);

        await actionHandlers[actionId](click);

        expect.soft(click.ack).toHaveBeenCalledOnce();
        expect
          .soft(click.client.chat.postEphemeral)
          .toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              channel: SYNTHETIC_CHANNEL_ALPHA,
              user: SYNTHETIC_USER_MAINTAINER,
              text: expect.stringContaining("checkout is unavailable"),
            }),
          );
        expect.soft(click.client.chat.postMessage).not.toHaveBeenCalled();
        expect.soft(claim).not.toHaveBeenCalled();
        expect.soft(mockSpawn).not.toHaveBeenCalled();
        expect.soft(mockContext.queue.enqueue).not.toHaveBeenCalled();
      },
    );

    it.each(["approve_spec", "revise_spec", "revise_plan"])(
      "keeps %s claimed until spawn and records asynchronous launch failure privately",
      async (actionId) => {
        const { project, registry } = createSqliteRegistry();
        mkdirSync(join(project.localRoot, "specs", actionValue.featureId), {
          recursive: true,
        });
        const complete = vi.spyOn(registry, "completeActionReceipt");
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        mockSpawn.mockReturnValueOnce(child);
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          projectRoot: project.localRoot,
          queueProjectId: project.projectId,
          routingService: createProjectRoutingService({ registry }),
        });
        const click = clickArgs(actionId, project.projectId);
        const pending = actionHandlers[actionId](click);
        await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));
        expect.soft(complete).not.toHaveBeenCalled();
        expect.soft(click.client.chat.postMessage).not.toHaveBeenCalled();
        expect.soft(child.listenerCount("error")).toBeGreaterThan(0);
        if (child.listenerCount("error") === 0) {
          await pending;
          return;
        }
        child.emit("error", new Error("worker executable missing"));
        await pending;
        expect(complete.mock.calls.map(([, outcome]) => outcome)).toEqual([
          "failed",
        ]);
        expect(click.client.chat.postMessage).not.toHaveBeenCalled();
        expect(click.client.chat.postEphemeral).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            user: SYNTHETIC_USER_MAINTAINER,
            channel: SYNTHETIC_CHANNEL_ALPHA,
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
            text: expect.stringContaining("worker executable missing"),
          }),
        );
      },
    );

    it.each([
      ["request_changes", null],
      ["approve_spec", ["define", "plan", actionValue.featureId]],
      ["approve_plan", null],
      ["revise_spec", ["define", "spec", actionValue.featureId]],
      ["revise_plan", ["define", "plan", actionValue.featureId]],
      ["retry_phase", null],
    ] as const)(
      "keeps %s executed when Slack rejects its confirmation",
      async (actionId, command) => {
        const { project, registry } = createSqliteRegistry();
        mkdirSync(join(project.localRoot, "specs", actionValue.featureId), {
          recursive: true,
        });
        const complete = vi.spyOn(registry, "completeActionReceipt");
        const enqueue = vi.mocked(mockContext.queue.enqueue);
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          projectRoot: project.localRoot,
          queueProjectId: project.projectId,
          routingService: createProjectRoutingService({ registry }),
        });
        const receiptKey = buildActionReceiptKey({
          ...actionValue,
          projectId: project.projectId,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
          messageTs,
          actionId,
        });
        const click = clickArgs(actionId, project.projectId);
        click.client.chat.postMessage.mockImplementation(async () => {
          expect
            .soft(registry.getActionReceipt(receiptKey)?.outcome)
            .toBe("executed");
          throw new Error("Slack confirmation rejected");
        });

        await actionHandlers[actionId](click);

        if (command) {
          expect
            .soft(mockSpawn)
            .toHaveBeenCalledExactlyOnceWith("gwrk", command, {
              cwd: realpathSync(project.localRoot),
              detached: true,
              stdio: "ignore",
            });
        } else if (actionId === "approve_plan") {
          expect
            .soft(mockHandleDefineComplete)
            .toHaveBeenCalledExactlyOnceWith({
              featureId: actionValue.featureId,
              status: "DEFINED",
            });
        } else {
          expect.soft(enqueue).toHaveBeenCalledExactlyOnceWith({
            featureId: actionValue.featureId,
            phaseId: actionValue.phaseId,
          });
        }
        expect
          .soft(
            mockSpawn.mock.calls.length +
              mockHandleDefineComplete.mock.calls.length +
              enqueue.mock.calls.length,
          )
          .toBe(1);
        expect
          .soft(complete.mock.calls.map(([key, outcome]) => [key, outcome]))
          .toEqual([[receiptKey, "executed"]]);
        expect
          .soft(registry.getActionReceipt(receiptKey)?.outcome)
          .toBe("executed");
        expect
          .soft(click.client.chat.postMessage)
          .toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              channel: SYNTHETIC_CHANNEL_ALPHA,
              thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
            }),
          );
        expect.soft(click.client.chat.postEphemeral).not.toHaveBeenCalled();
        expect(click.logger.error).toHaveBeenCalledExactlyOnceWith(
          expect.stringContaining("Slack confirmation rejected"),
        );
      },
    );

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
          expectedRepository: "github.com/org/alpha",
        },
      );
      expect(execSync).not.toHaveBeenCalled();
      expect(click.client.chat.postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("No open PR found"),
        }),
      );
    });

    function reactionArgs(
      projectId: string,
      cardTs = messageTs,
      value = { ...actionValue, projectId },
    ) {
      return {
        event: {
          type: "reaction_added",
          item_user: "U_GWRK_BOT",
          user: SYNTHETIC_USER_MAINTAINER,
          reaction: "white_check_mark",
          item: {
            type: "message",
            channel: SYNTHETIC_CHANNEL_ALPHA,
            ts: cardTs,
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
                ts: cardTs,
                text: "Review Ready",
                thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
                blocks: [
                  {
                    type: "actions",
                    elements: [
                      {
                        type: "button",
                        action_id: "merge_pr",
                        value: JSON.stringify(value),
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

    it.each(["phase-02", "phase-01"])(
      "keeps a phase-01 review card for PR 101 from merging PR 202 in %s",
      async (openPhase) => {
        const card = { ...actionValue, prNumber: 101 };
        const registry = createSyntheticRegistry();
        const vcs = createSyntheticVcsPort();
        const merge = vi.spyOn(vcs, "mergePullRequest");
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
          vcs,
        });
        const click = clickArgs("merge_pr");
        click.body.actions[0].value = JSON.stringify(card);
        const reaction = reactionArgs(
          card.projectId,
          "1731320000.000300",
          card,
        );

        const lookup = vi.mocked(findOpenPr);
        await lookup.withImplementation(
          (_featureId, _projectId, phaseId) =>
            phaseId === undefined || phaseId === openPhase
              ? {
                  pr_number: 202,
                  pr_url: "https://github.com/org/alpha/pull/202",
                }
              : null,
          async () => {
            await actionHandlers.merge_pr(click);
            await eventHandlers.reaction_added(reaction);
          },
        );

        expect.soft(merge).not.toHaveBeenCalled();
        expect.soft(click.client.chat.postMessage).not.toHaveBeenCalled();
        expect.soft(reaction.client.chat.postMessage).not.toHaveBeenCalled();
        expect(lookup.mock.calls).toEqual([
          [card.featureId, card.projectId, card.phaseId],
          [card.featureId, card.projectId, card.phaseId],
        ]);
      },
    );

    const mergeTarget = { repository: "github.com/org/alpha", prNumber: 42 };

    function mergeReceiptKey(projectId: string, attempt = 0) {
      return buildActionReceiptKey({
        ...actionValue,
        projectId,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        messageTs,
        actionId: attempt ? `merge_pr:retry:${attempt}` : "merge_pr",
      });
    }

    it("records origin drift as failed and allows one retry after origin is restored", async () => {
      const { registry, project } = createSqliteRegistry();
      const root = project.localRoot;
      const calls = join(root, "gh-calls");
      writeFileSync(calls, "");
      writeFileSync(
        join(root, "gh"),
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$GWRK_TEST_GH_CALLS"\nprintf \'%s\\n\' \'{"number":42,"state":"OPEN"}\'\n',
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
      vi.stubEnv("GWRK_TEST_GH_CALLS", calls);
      onTestFinished(() => vi.unstubAllEnvs());

      const vcs = createGitVcsAdapter();
      await registerSlackActions(mockApp as App, {
        ...mockContext,
        routingService: createProjectRoutingService({ registry }),
        vcs,
      });
      const click = clickArgs("merge_pr", project.projectId);
      const receiptKey = mergeReceiptKey(project.projectId);
      function setOrigin(repository: string) {
        execFileSync("git", [
          "-C",
          root,
          "remote",
          "set-url",
          "origin",
          repository,
        ]);
      }

      setOrigin("https://github.com/org/beta.git");
      await actionHandlers.merge_pr(click);
      expect
        .soft(click.client.chat.postEphemeral)
        .toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            channel: SYNTHETIC_CHANNEL_ALPHA,
            user: SYNTHETIC_USER_MAINTAINER,
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
            text: expect.stringContaining("Failed to merge PR"),
          }),
        );
      expect.soft(readFileSync(calls, "utf8")).toBe("");
      expect.soft(registry.getActionReceipt(receiptKey)).toMatchObject({
        outcome: "failed",
        mergeTarget,
      });

      setOrigin("https://github.com/org/alpha.git");
      await Promise.all([
        actionHandlers.merge_pr(clickArgs("merge_pr", project.projectId)),
        actionHandlers.merge_pr(clickArgs("merge_pr", project.projectId)),
      ]);
      expect
        .soft(readFileSync(calls, "utf8").trim().split("\n"))
        .toEqual([
          "pr merge 42 --merge --delete-branch --repo github.com/org/alpha",
        ]);
      expect
        .soft(registry.getActionReceipt(mergeReceiptKey(project.projectId, 1)))
        .toMatchObject({ outcome: "executed", mergeTarget });
      expect(
        registry.getActionReceipt(mergeReceiptKey(project.projectId, 2)),
      ).toBeNull();
    });

    it.each(["button", "reaction"])(
      "reconciles a crash-left claimed receipt for a remotely merged %s without a second merge",
      async (surface) => {
        const { registry, project } = createSqliteRegistry();
        const key = mergeReceiptKey(project.projectId);
        registry.claimActionReceipt({
          ...actionValue,
          projectId: project.projectId,
          receiptKey: key,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
          messageTs,
          actionId: "merge_pr",
          actorUserId: SYNTHETIC_USER_MAINTAINER,
          recordedAt: new Date().toISOString(),
          outcome: "claimed",
          mergeTarget,
        });
        const inspect = vi.fn(async () => "merged" as const);
        const vcs = createSyntheticVcsPort({
          inspectPullRequestMerge: inspect,
        });
        const merge = vi.spyOn(vcs, "mergePullRequest");
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
          vcs,
        });
        if (surface === "button")
          await actionHandlers.merge_pr(
            clickArgs("merge_pr", project.projectId),
          );
        else
          await eventHandlers.reaction_added(reactionArgs(project.projectId));
        expect(registry.getActionReceipt(key)?.outcome).toBe("executed");
        expect(inspect).toHaveBeenCalledWith(project.localRoot, mergeTarget);
        expect(merge).not.toHaveBeenCalled();
      },
    );

    it("matches durable receipt compare-and-set and terminal guards in the synthetic registry", () => {
      const registry = createSyntheticRegistry();
      const key = mergeReceiptKey(SYNTHETIC_PROJECT_ALPHA.projectId);
      registry.claimActionReceipt({
        ...actionValue,
        receiptKey: key,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        messageTs,
        actionId: "merge_pr",
        actorUserId: SYNTHETIC_USER_MAINTAINER,
        recordedAt: new Date().toISOString(),
        outcome: "claimed",
        mergeTarget,
      });
      expect(registry.completeActionReceipt(key, "executed", "uncertain")).toBe(
        false,
      );
      expect(registry.getActionReceipt(key)?.outcome).toBe("claimed");
      expect(registry.completeActionReceipt(key, "executed", "claimed")).toBe(
        true,
      );
      expect(registry.completeActionReceipt(key, "failed")).toBe(false);
      expect(registry.getActionReceipt(key)?.outcome).toBe("executed");
    });

    it.each(["button", "reaction"])(
      "reconciles the original receipt after a %s merge times out after the remote effect",
      async (surface) => {
        const { registry, project } = createSqliteRegistry();
        const inspect = vi.fn(async () => "merged" as const);
        const vcs = createSyntheticVcsPort({
          inspectPullRequestMerge: inspect,
        });
        const merge = vi
          .spyOn(vcs, "mergePullRequest")
          .mockImplementationOnce((cwd, prNumber) => {
            vcs.mergedPrs.push({ cwd, prNumber });
            throw Object.assign(
              new Error("Merge response timed out after remote effect"),
              { code: "ETIMEDOUT" },
            );
          });
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
          vcs,
        });
        const reaction = reactionArgs(project.projectId);
        const click = clickArgs("merge_pr", project.projectId);
        const receiptKey = mergeReceiptKey(project.projectId);
        if (surface === "button") await actionHandlers.merge_pr(click);
        else await eventHandlers.reaction_added(reaction);

        const client = surface === "button" ? click.client : reaction.client;
        expect.soft(client.chat.postEphemeral).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            channel: SYNTHETIC_CHANNEL_ALPHA,
            user: SYNTHETIC_USER_MAINTAINER,
            thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
            text: expect.stringContaining("Merge outcome unknown"),
          }),
        );
        expect.soft(registry.getActionReceipt(receiptKey)).toMatchObject({
          outcome: "uncertain",
          mergeTarget,
        });
        await eventHandlers.reaction_added({
          ...reaction,
          context: { retryNum: 1 },
        });
        expect.soft(inspect).not.toHaveBeenCalled();

        const editedCard = reactionArgs(project.projectId, messageTs, {
          ...actionValue,
          projectId: project.projectId,
          prNumber: 202,
        });
        editedCard.event.event_ts = "1731320000.000500";
        await eventHandlers.reaction_added(editedCard);
        await actionHandlers.merge_pr(click);

        expect
          .soft(inspect)
          .toHaveBeenCalledExactlyOnceWith(project.localRoot, mergeTarget);
        expect.soft(registry.getActionReceipt(receiptKey)).toMatchObject({
          outcome: "executed",
          mergeTarget,
        });
        expect
          .soft(merge)
          .toHaveBeenCalledExactlyOnceWith(
            project.localRoot,
            42,
            mergeTarget.repository,
          );
        expect(
          registry.getActionReceipt(mergeReceiptKey(project.projectId, 1)),
        ).toBeNull();
        expect(vcs.mergedPrs).toEqual([
          { cwd: project.localRoot, prNumber: 42 },
        ]);
      },
    );

    it.each(["missing", "unavailable", "throwing"])(
      "keeps a timed-out merge uncertain when inspection is %s",
      async (capability) => {
        const { registry, project } = createSqliteRegistry();
        const inspect = vi.fn(async () => {
          if (capability === "throwing")
            throw new Error("Inspection timed out");
          return "unavailable" as const;
        });
        const vcs = createSyntheticVcsPort({
          inspectPullRequestMerge:
            capability === "missing" ? undefined : inspect,
        });
        const merge = vi
          .spyOn(vcs, "mergePullRequest")
          .mockRejectedValueOnce(new Error("Merge response timed out"));
        await registerSlackActions(mockApp as App, {
          ...mockContext,
          routingService: createProjectRoutingService({ registry }),
          vcs,
        });

        await actionHandlers.merge_pr(clickArgs("merge_pr", project.projectId));
        const retry = reactionArgs(project.projectId);
        await eventHandlers.reaction_added(retry);

        expect
          .soft(registry.getActionReceipt(mergeReceiptKey(project.projectId)))
          .toMatchObject({
            outcome: "uncertain",
            mergeTarget,
          });
        if (capability !== "missing") {
          expect
            .soft(inspect)
            .toHaveBeenCalledExactlyOnceWith(project.localRoot, mergeTarget);
        }
        expect(merge).toHaveBeenCalledTimes(1);
      },
    );

    it("leaves a legacy uncertain receipt blocked when it lacks a merge target", async () => {
      const { registry, project } = createSqliteRegistry();
      const receiptKey = mergeReceiptKey(project.projectId);
      registry.claimActionReceipt({
        ...actionValue,
        projectId: project.projectId,
        receiptKey,
        actionId: "merge_pr",
        messageTs,
        actorUserId: SYNTHETIC_USER_MAINTAINER,
        outcome: "claimed",
        recordedAt: "2026-11-18T10:00:00.000Z",
      });
      registry.completeActionReceipt(receiptKey, "uncertain");
      const inspect = vi.fn(async () => "rejected" as const);
      const vcs = createSyntheticVcsPort({ inspectPullRequestMerge: inspect });
      const merge = vi.spyOn(vcs, "mergePullRequest");
      await registerSlackActions(mockApp as App, {
        ...mockContext,
        routingService: createProjectRoutingService({ registry }),
        vcs,
      });

      await eventHandlers.reaction_added(reactionArgs(project.projectId));
      expect(inspect).not.toHaveBeenCalled();
      expect(merge).not.toHaveBeenCalled();
      expect(registry.getActionReceipt(receiptKey)?.outcome).toBe("uncertain");
    });

    it("claims one concurrent retry after inspection confirms rejection", async () => {
      const { registry, project } = createSqliteRegistry();
      let finishInspection!: (outcome: "rejected") => void;
      const inspection = new Promise<"rejected">((resolve) => {
        finishInspection = resolve;
      });
      const inspect = vi.fn(() => inspection);
      const vcs = createSyntheticVcsPort({ inspectPullRequestMerge: inspect });
      const merge = vi
        .spyOn(vcs, "mergePullRequest")
        .mockRejectedValueOnce(new Error("Merge response timed out"));
      await registerSlackActions(mockApp as App, {
        ...mockContext,
        routingService: createProjectRoutingService({ registry }),
        vcs,
      });
      const reaction = reactionArgs(project.projectId);
      await eventHandlers.reaction_added(reaction);
      const receiptKey = mergeReceiptKey(project.projectId);
      expect
        .soft(registry.getActionReceipt(receiptKey)?.outcome)
        .toBe("uncertain");

      const retry = reactionArgs(project.projectId);
      retry.event.event_ts = "1731320000.000500";
      const retries = Promise.all([
        eventHandlers.reaction_added(retry),
        actionHandlers.merge_pr(clickArgs("merge_pr", project.projectId)),
      ]);

      try {
        await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
      } finally {
        finishInspection("rejected");
        await retries;
      }
      expect.soft(inspect).toHaveBeenCalledWith(project.localRoot, mergeTarget);
      expect
        .soft(registry.getActionReceipt(receiptKey)?.outcome)
        .toBe("failed");
      expect(merge.mock.calls).toEqual([
        [project.localRoot, 42, mergeTarget.repository],
        [project.localRoot, 42, mergeTarget.repository],
      ]);
      expect(
        registry.getActionReceipt(mergeReceiptKey(project.projectId, 1)),
      ).toMatchObject({
        outcome: "executed",
        mergeTarget,
      });
      expect(
        registry.getActionReceipt(mergeReceiptKey(project.projectId, 2)),
      ).toBeNull();
    });

    it("grants one retry when the earlier reaction was rejected before merging", async () => {
      const { registry, project } = createSqliteRegistry();
      const vcs = createSyntheticVcsPort();
      const merge = vi.spyOn(vcs, "mergePullRequest");
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

      vi.mocked(findOpenPr).mockReturnValueOnce(null);
      await eventHandlers.reaction_added(reaction);

      expect(merge).not.toHaveBeenCalled();
      expect(registry.getActionReceipt(receiptKey)?.outcome).toBe("failed");
      expect(reaction.client.chat.postMessage).not.toHaveBeenCalled();

      await eventHandlers.reaction_added({
        ...reaction,
        context: { retryNum: 1 },
      });
      expect(merge).not.toHaveBeenCalled();

      const retry = {
        ...reaction,
        event: { ...reaction.event, event_ts: "1731320000.000500" },
      };
      await Promise.all([
        eventHandlers.reaction_added(retry),
        eventHandlers.reaction_added(retry),
      ]);
      await eventHandlers.reaction_added(retry);

      expect(merge).toHaveBeenCalledExactlyOnceWith(
        project.localRoot,
        42,
        mergeTarget.repository,
      );
      const retryKey = buildActionReceiptKey({
        ...actionValue,
        projectId: project.projectId,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        channelId: SYNTHETIC_CHANNEL_ALPHA,
        messageTs,
        actionId: "merge_pr:retry:1",
      });
      expect(registry.getActionReceipt(retryKey)?.outcome).toBe("executed");
      expect(reaction.client.chat.postMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          channel: SYNTHETIC_CHANNEL_ALPHA,
          thread_ts: SYNTHETIC_THREAD_ALPHA.rootTs,
        }),
      );
    });

    it.each([
      { featureId: "999-new-feature" },
      { featureId: "999-new-feature", opsOnly: true },
      {},
    ])(
      "reports an undelivered event when the port returns void for %j",
      async (scope) => {
        const registry = createSyntheticRegistry();
        const bind = vi.spyOn(registry, "bindFeatureThread");
        const voidNotificationPort = {
          notify: vi.fn().mockResolvedValue(undefined),
        };
        const routingService = createProjectRoutingService({
          registry,
          notificationPort: voidNotificationPort,
        });

        const receipt = await routingService.deliverProjectEvent({
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          ...scope,
          eventType: "spec_ready",
          message: { text: "Spec ready for review" },
          nowIso: "2026-11-18T10:00:00.000Z",
        });

        expect(receipt).toEqual({ delivered: false });
        expect(voidNotificationPort.notify).toHaveBeenCalledOnce();
        expect(bind).not.toHaveBeenCalled();
        expect(
          registry.getFeatureThread(
            SYNTHETIC_PROJECT_ALPHA.projectId,
            "999-new-feature",
          ),
        ).toBeNull();
      },
    );
  });
});
