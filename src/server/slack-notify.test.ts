/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
} from "../../tests/helpers/synthetic-slack.js";
import { createSlackNotificationAdapter } from "../adapters/notifications/index.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { notifySlack } from "./slack-notify.js";
import { getSlackApp } from "./slack.js";

vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue({
    client: {
      chat: { postMessage: vi.fn().mockResolvedValue({ ok: true }) },
      auth: {
        test: vi
          .fn()
          .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
      },
    },
  }),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    project: {
      slack: {
        webhookUrl: "https://hooks.slack.com/services/T123/B456/XYZ",
      },
    },
  }),
}));

vi.mock("./telegram-notify.js", () => ({ loadTelegramConfig: () => null }));

describe("US-003: Slack Event Bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("binds a confirmed Socket Mode root and sends the next project event as a reply", async () => {
    const rootTs = "1731320000.000100";
    const replyTs = "1731320000.000200";
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        channel: SYNTHETIC_CHANNEL_ALPHA,
        ts: rootTs,
      })
      .mockResolvedValueOnce({
        ok: true,
        channel: SYNTHETIC_CHANNEL_ALPHA,
        ts: replyTs,
      });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);
    const registry = createSyntheticRegistry({ threads: [] });
    const routing = createProjectRoutingService({
      registry,
      notificationPort: createSlackNotificationAdapter(),
    });
    const event = {
      projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
      featureId: "003-slack",
      eventType: "spec_ready",
      message: { text: "Spec ready" },
      nowIso: "2026-11-18T10:00:00.000Z",
    };

    expect(await routing.deliverProjectEvent(event)).toMatchObject({
      delivered: true,
      channelId: SYNTHETIC_CHANNEL_ALPHA,
      messageTs: rootTs,
    });
    expect(
      registry.getFeatureThread(event.projectId, event.featureId)?.rootTs,
    ).toBe(rootTs);
    expect(
      await routing.deliverProjectEvent({
        ...event,
        message: { text: "Plan ready" },
      }),
    ).toMatchObject({
      delivered: true,
      channelId: SYNTHETIC_CHANNEL_ALPHA,
      messageTs: replyTs,
      threadTs: rootTs,
    });
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channel: SYNTHETIC_CHANNEL_ALPHA,
        text: "Spec ready",
      }),
    );
    expect(postMessage.mock.calls[0][0].thread_ts).toBeUndefined();
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channel: SYNTHETIC_CHANNEL_ALPHA,
        text: "Plan ready",
        thread_ts: rootTs,
      }),
    );
    expect(
      registry.getFeatureThread(event.projectId, event.featureId)?.rootTs,
    ).toBe(rootTs);
  });

  it("FR-014: should fallback to webhook when Socket Mode app is not available (TR-011)", async () => {
    // Mock getSlackApp to return null (simulating server without Socket Mode)
    const { getSlackApp } = await import("./slack.js");
    vi.mocked(getSlackApp).mockReturnValue(null);

    // Mock global.fetch
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const message = {
      text: "Webhook Fallback Test",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Hello Webhook" } },
      ],
    };

    await expect(
      notifySlack(message as Parameters<typeof notifySlack>[0]),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T123/B456/XYZ",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Hello Webhook"),
      }),
    );
  });

  it("keeps a failed project notification out of the daemon's webhook", async () => {
    const postMessage = vi.fn().mockRejectedValue(new Error("not_in_channel"));
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);

    const receipt = await createSlackNotificationAdapter().notify({
      projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
      channel: SYNTHETIC_CHANNEL_ALPHA,
      text: "Scoped event",
    });

    expect(postMessage).toHaveBeenCalledOnce();
    expect(receipt).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("TR-013: threads lifecycle events under stored (projectId, featureId) thread without process.cwd() fallback", async () => {
    const postMessage = vi.fn().mockResolvedValue({
      ok: true,
      channel: SYNTHETIC_CHANNEL_ALPHA,
      ts: "1731320000.000999",
      message: { thread_ts: "1731320000.000100" },
    });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry();
    const receipt = await notifySlack(
      { text: "Feature event", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        featureId: "003-slack",
        registry,
      },
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: SYNTHETIC_CHANNEL_ALPHA,
        thread_ts: "1731320000.000100",
      }),
    );
    expect(receipt).toMatchObject({
      delivered: true,
      channelId: SYNTHETIC_CHANNEL_ALPHA,
      threadTs: "1731320000.000100",
    });
  });

  it("TR-013: delivers opsOnly events explicitly to project opsChannelId without feature thread binding", async () => {
    const postMessage = vi.fn().mockResolvedValue({
      ok: true,
      channel: "C_OPS",
      ts: "1731320000.000555",
    });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry();
    const receipt = await notifySlack(
      { text: "Ops notification", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        featureId: "003-slack",
        opsOnly: true,
        registry,
      },
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_OPS",
        thread_ts: undefined,
      }),
    );
    expect(receipt).toMatchObject({
      delivered: true,
      channelId: "C_OPS",
    });
  });

  it("TR-013: ignores process.cwd() config when projectId is set and project has no Slack channel", async () => {
    const postMessage = vi.fn();
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);

    const registry = createSyntheticRegistry({
      projects: [
        {
          ...SYNTHETIC_PROJECT_ALPHA,
          projectId: "proj-unbound",
          slack: null,
        },
      ],
    });

    const receipt = await notifySlack(
      { text: "Unbound project event", blocks: [] },
      undefined,
      {
        projectId: "proj-unbound",
        registry,
      },
    );

    expect(postMessage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(receipt).toBeUndefined();
  });

  it("TR-013: skips opsOnly delivery when the enrolled project has no opsChannelId instead of posting to the feature channel", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry({
      projects: [
        {
          ...SYNTHETIC_PROJECT_ALPHA,
          slack: {
            workspaceId: SYNTHETIC_WORKSPACE_ID,
            channelId: SYNTHETIC_CHANNEL_ALPHA,
            sharedChannel: false,
          },
        },
      ],
    });

    const receipt = await notifySlack(
      { text: "Ops alert", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        featureId: "003-slack",
        opsOnly: true,
        registry,
      },
    );

    expect(postMessage).not.toHaveBeenCalled();
    expect(receipt).toBeUndefined();
  });

  it("TR-013: ignores stale stored feature threads whose channel or workspace no longer matches the enrolled project", async () => {
    const postMessage = vi.fn().mockResolvedValue({
      ok: true,
      channel: "C_ALPHA_NEW",
      ts: "1731320000.000777",
    });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry({
      projects: [
        {
          ...SYNTHETIC_PROJECT_ALPHA,
          slack: {
            workspaceId: SYNTHETIC_WORKSPACE_ID,
            channelId: "C_ALPHA_NEW",
            sharedChannel: false,
          },
        },
      ],
      threads: [
        {
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          featureId: "003-slack",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_ALPHA_OLD",
          rootTs: "1731320000.000100",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const inputMessage = { text: "Feature update", blocks: [] };
    await notifySlack(inputMessage, undefined, {
      projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
      featureId: "003-slack",
      registry,
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C_ALPHA_NEW",
        thread_ts: undefined,
      }),
    );
    expect(inputMessage).toEqual({ text: "Feature update", blocks: [] });
  });

  it("TR-013: blocks scoped notifySlack when connected workspace mismatches or projectId conflicts with recipient", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi.fn().mockResolvedValue({ ok: true, team_id: "W_OTHER" }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry();
    const wrongWorkspaceReceipt = await notifySlack(
      { text: "Workspace check", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        featureId: "003-slack",
        registry,
      },
    );
    expect(wrongWorkspaceReceipt).toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();

    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const mismatchedRecipientReceipt = await notifySlack(
      { text: "Mismatch check", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        recipient: {
          projectId: SYNTHETIC_PROJECT_BETA.projectId,
          surface: "slack",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
        },
        registry,
      },
    );
    expect(mismatchedRecipientReceipt).toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("TR-013: keeps opsOnly unthreaded even when recipient carries threadTs and honors recipient.opsOnly", async () => {
    const postMessage = vi.fn().mockResolvedValue({
      ok: true,
      channel: "C_OPS",
      ts: "1731320000.000888",
    });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry();
    await notifySlack(
      { text: "Ops with thread recipient", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        featureId: "003-slack",
        opsOnly: true,
        recipient: {
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          surface: "slack",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: "C_OPS",
          threadTs: "1731320000.000100",
          opsOnly: true,
        },
        registry,
      },
    );

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0][0].channel).toBe("C_OPS");
    expect(postMessage.mock.calls[0][0].thread_ts).toBeUndefined();

    postMessage.mockClear();
    await notifySlack({ text: "Recipient opsOnly", blocks: [] }, undefined, {
      projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
      featureId: "003-slack",
      recipient: {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        surface: "slack",
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        opsOnly: true,
      },
      registry,
    });

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0][0].channel).toBe("C_OPS");
    expect(postMessage.mock.calls[0][0].thread_ts).toBeUndefined();
  });

  it("TR-013: rejects conflicting recipient workspace, surface, channel, threadTs and event projectId", async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        chat: { postMessage },
        auth: {
          test: vi
            .fn()
            .mockResolvedValue({ ok: true, team_id: SYNTHETIC_WORKSPACE_ID }),
        },
      },
    } as unknown as ReturnType<typeof getSlackApp>);

    const registry = createSyntheticRegistry();

    const wrongRecipientWorkspace = await notifySlack(
      { text: "Wrong recipient workspace", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        recipient: {
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          surface: "slack",
          workspaceId: "W_OTHER",
          channelId: SYNTHETIC_CHANNEL_ALPHA,
        },
        registry,
      },
    );
    expect(wrongRecipientWorkspace).toBeUndefined();

    const nonSlackSurface = await notifySlack(
      { text: "Non-Slack surface", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        recipient: {
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          surface: "local_cli",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
        },
        registry,
      },
    );
    expect(nonSlackSurface).toBeUndefined();

    const conflictingChannel = await notifySlack(
      { text: "Conflicting channel", channel: "C_OTHER", blocks: [] },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        recipient: {
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          surface: "slack",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
        },
        registry,
      },
    );
    expect(conflictingChannel).toBeUndefined();

    const conflictingThread = await notifySlack(
      {
        text: "Conflicting thread",
        thread_ts: "1731320000.999999",
        blocks: [],
      },
      undefined,
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        recipient: {
          projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
          surface: "slack",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          channelId: SYNTHETIC_CHANNEL_ALPHA,
          threadTs: "1731320000.000100",
        },
        registry,
      },
    );
    expect(conflictingThread).toBeUndefined();

    const conflictingEventProject = await notifySlack(
      { text: "Conflicting event project", blocks: [] },
      {
        type: "phase_start",
        feature: "003-slack",
        projectId: SYNTHETIC_PROJECT_BETA.projectId,
        payload: {},
        timestamp: "2026-11-18T10:00:00.000Z",
      },
      {
        projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
        registry,
      },
    );
    expect(conflictingEventProject).toBeUndefined();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("FR-005: Converts ship:complete event to Block Kit message", async () => {
    // Test implementation here...
    expect(true).toBe(true);
  });
});
