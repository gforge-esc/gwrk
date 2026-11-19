/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import type {
  DeliveryRecipient,
  EnrolledProject,
  SlackFeatureThread,
} from "./project-registry.js";
import {
  partitionAwayBatch,
  resolveAwayQueueTarget,
  resolveSlackDeliveryRoute,
  validateSlackDeliveryContext,
} from "./slack-delivery.js";

const alphaProject: EnrolledProject = {
  projectId: "proj-alpha",
  slug: "alpha",
  name: "Alpha",
  repoSlug: "org/alpha",
  trunkBranch: "main",
  localRoot: "/tmp/alpha",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: {
    workspaceId: "W1",
    channelId: "C-alpha",
    opsChannelId: "C-ops",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

const alphaRecipient: DeliveryRecipient = {
  projectId: "proj-alpha",
  surface: "slack",
  workspaceId: "W1",
  channelId: "C-alpha",
  threadTs: "1700000000.000100",
  actorUserId: "U-alice",
};

const validThread: SlackFeatureThread = {
  projectId: "proj-alpha",
  featureId: "048-slack",
  workspaceId: "W1",
  channelId: "C-alpha",
  rootTs: "1700000000.000100",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

describe("validateSlackDeliveryContext", () => {
  it("rejects non-Slack recipient surfaces", () => {
    expect(
      validateSlackDeliveryContext({
        recipient: { ...alphaRecipient, surface: "local_cli" },
      }),
    ).toEqual({ ok: false, code: "NON_SLACK_SURFACE" });

    expect(
      validateSlackDeliveryContext({
        eventRecipient: { ...alphaRecipient, surface: "http" },
      }),
    ).toEqual({ ok: false, code: "NON_SLACK_SURFACE" });
  });

  it("rejects conflicting projectId values across option, event and recipients", () => {
    expect(
      validateSlackDeliveryContext({
        projectId: "proj-alpha",
        eventProjectId: "proj-beta",
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_PROJECT_ID" });

    expect(
      validateSlackDeliveryContext({
        projectId: "proj-alpha",
        recipient: { ...alphaRecipient, projectId: "proj-beta" },
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_PROJECT_ID" });

    expect(
      validateSlackDeliveryContext({
        eventProjectId: "proj-alpha",
        eventRecipient: { ...alphaRecipient, projectId: "proj-beta" },
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_PROJECT_ID" });
  });

  it("rejects conflicting channelId, threadTs and workspaceId hints", () => {
    expect(
      validateSlackDeliveryContext({
        channelId: "C-other",
        recipient: alphaRecipient,
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_CHANNEL_ID" });

    expect(
      validateSlackDeliveryContext({
        threadTs: "1700000000.999999",
        recipient: alphaRecipient,
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_THREAD_TS" });

    expect(
      validateSlackDeliveryContext({
        recipient: alphaRecipient,
        eventRecipient: { ...alphaRecipient, workspaceId: "W2" },
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_WORKSPACE_ID" });
  });

  it("combines opsOnly with Boolean OR and clears threadTs on both context and recipient", () => {
    const result = validateSlackDeliveryContext({
      projectId: "proj-alpha",
      recipient: { ...alphaRecipient, opsOnly: true },
    });
    expect(result).toEqual({
      ok: true,
      context: {
        projectId: "proj-alpha",
        workspaceId: "W1",
        channelId: "C-alpha",
        threadTs: undefined,
        opsOnly: true,
        recipient: {
          ...alphaRecipient,
          threadTs: undefined,
          opsOnly: true,
        },
      },
    });
  });
});

describe("resolveSlackDeliveryRoute", () => {
  it("rejects recipient workspace mismatches against enrolled project binding", () => {
    expect(
      resolveSlackDeliveryRoute({
        projectId: "proj-alpha",
        recipient: { ...alphaRecipient, workspaceId: "W_OTHER" },
        project: alphaProject,
      }),
    ).toEqual({ ok: false, code: "CONFLICTING_WORKSPACE_ID" });
  });

  it("routes opsOnly notifications to the enrolled ops channel with no thread on route or recipient", () => {
    const result = resolveSlackDeliveryRoute({
      projectId: "proj-alpha",
      recipient: {
        ...alphaRecipient,
        channelId: "C-ops",
        threadTs: "1700000000.000100",
        opsOnly: true,
      },
      project: alphaProject,
      storedThread: validThread,
    });
    expect(result).toEqual({
      ok: true,
      route: {
        projectId: "proj-alpha",
        expectedWorkspaceId: "W1",
        channelId: "C-ops",
        threadTs: undefined,
        opsOnly: true,
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-ops",
          threadTs: undefined,
          actorUserId: "U-alice",
          opsOnly: true,
        },
      },
    });
  });

  it("skips opsOnly delivery when an enrolled project has no opsChannelId", () => {
    const projectWithoutOps: EnrolledProject = {
      ...alphaProject,
      slack: {
        workspaceId: "W1",
        channelId: "C-alpha",
        sharedChannel: false,
      },
    };
    expect(
      resolveSlackDeliveryRoute({
        projectId: "proj-alpha",
        opsOnly: true,
        project: projectWithoutOps,
      }),
    ).toEqual({ ok: false, code: "MISSING_OPS_CHANNEL" });
  });

  it("allows direct accepted-recipient opsOnly delivery without an enrolled project and stays unthreaded", () => {
    const result = resolveSlackDeliveryRoute({
      projectId: "proj-alpha",
      opsOnly: true,
      channelId: "C-ops",
      recipient: {
        projectId: "proj-alpha",
        surface: "slack",
        workspaceId: "W1",
        channelId: "C-ops",
        threadTs: "1700000000.000100",
        opsOnly: true,
      },
      project: null,
    });
    expect(result).toEqual({
      ok: true,
      route: {
        projectId: "proj-alpha",
        expectedWorkspaceId: "W1",
        channelId: "C-ops",
        threadTs: undefined,
        opsOnly: true,
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-ops",
          threadTs: undefined,
          actorUserId: undefined,
          opsOnly: true,
        },
      },
    });
  });

  it("applies stored feature thread only when workspace and channel still match project binding", () => {
    const matched = resolveSlackDeliveryRoute({
      projectId: "proj-alpha",
      project: alphaProject,
      storedThread: validThread,
    });
    expect(matched).toEqual({
      ok: true,
      route: {
        projectId: "proj-alpha",
        expectedWorkspaceId: "W1",
        channelId: "C-alpha",
        threadTs: "1700000000.000100",
        opsOnly: false,
        recipient: undefined,
      },
    });

    const staleChannel = resolveSlackDeliveryRoute({
      projectId: "proj-alpha",
      project: alphaProject,
      storedThread: { ...validThread, channelId: "C-old" },
    });
    expect(staleChannel).toEqual({
      ok: true,
      route: {
        projectId: "proj-alpha",
        expectedWorkspaceId: "W1",
        channelId: "C-alpha",
        threadTs: undefined,
        opsOnly: false,
        recipient: undefined,
      },
    });

    const staleWorkspace = resolveSlackDeliveryRoute({
      projectId: "proj-alpha",
      project: alphaProject,
      storedThread: { ...validThread, workspaceId: "W-old" },
    });
    expect(staleWorkspace).toEqual({
      ok: true,
      route: {
        projectId: "proj-alpha",
        expectedWorkspaceId: "W1",
        channelId: "C-alpha",
        threadTs: undefined,
        opsOnly: false,
        recipient: undefined,
      },
    });
  });

  it("preserves an already accepted recipient route and never falls back to cwd config for scoped projects", () => {
    const dmRecipient: DeliveryRecipient = {
      projectId: "proj-alpha",
      surface: "slack",
      workspaceId: "W1",
      channelId: "D-dm",
      threadTs: "1700000000.000999",
    };
    const dmRoute = resolveSlackDeliveryRoute({
      projectId: "proj-alpha",
      recipient: dmRecipient,
      project: alphaProject,
      storedThread: validThread,
    });
    expect(dmRoute).toEqual({
      ok: true,
      route: {
        projectId: "proj-alpha",
        expectedWorkspaceId: "W1",
        channelId: "D-dm",
        threadTs: "1700000000.000999",
        opsOnly: false,
        recipient: {
          ...dmRecipient,
          actorUserId: undefined,
          opsOnly: undefined,
        },
      },
    });

    const unbound = resolveSlackDeliveryRoute({
      projectId: "proj-unbound",
      project: { ...alphaProject, projectId: "proj-unbound", slack: null },
      fallbackChannelId: "C-cwd-leak",
      requireChannel: true,
    });
    expect(unbound).toEqual({ ok: false, code: "MISSING_CHANNEL" });
  });
});

describe("resolveAwayQueueTarget", () => {
  it("never falls back to legacyUserId for scoped project notifications", () => {
    expect(
      resolveAwayQueueTarget({
        projectId: "proj-beta",
        recipient: {
          projectId: "proj-beta",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-beta",
        },
        legacyUserId: "U-alice",
      }),
    ).toEqual({
      isScoped: true,
      projectId: "proj-beta",
      recipientUserId: undefined,
    });
  });

  it("preserves legacyUserId fallback only on the unscoped default path", () => {
    expect(
      resolveAwayQueueTarget({
        legacyUserId: "U-legacy",
      }),
    ).toEqual({
      isScoped: false,
      projectId: "default",
      recipientUserId: "U-legacy",
    });
  });
});

describe("partitionAwayBatch", () => {
  it("partitions by channel and opsOnly, preserving single-thread feature batches and clearing multi-thread recipients", () => {
    const partitions = partitionAwayBatch([
      {
        event: { feature: "feat-1" },
        message: { text: "m1" },
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-alpha",
          threadTs: "1700000000.000111",
          actorUserId: "U-alice",
        },
        channelId: "C-alpha",
        threadTs: "1700000000.000111",
        opsOnly: false,
      },
      {
        event: { feature: "feat-2" },
        message: { text: "m2" },
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-alpha",
          threadTs: "1700000000.000222",
          actorUserId: "U-alice",
        },
        channelId: "C-alpha",
        threadTs: "1700000000.000222",
        opsOnly: false,
      },
      {
        event: { feature: "ops-health" },
        message: { text: "ops" },
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-ops",
          actorUserId: "U-alice",
          opsOnly: true,
        },
        channelId: "C-ops",
        opsOnly: true,
      },
    ]);

    expect(partitions).toHaveLength(2);
    expect(partitions[0]).toMatchObject({
      opsOnly: false,
      channelId: "C-alpha",
      threadTs: undefined,
      recipient: {
        channelId: "C-alpha",
        threadTs: undefined,
        opsOnly: undefined,
      },
    });
    expect(partitions[0].items.map((item) => item.event.feature)).toEqual([
      "feat-1",
      "feat-2",
    ]);

    expect(partitions[1]).toMatchObject({
      opsOnly: true,
      channelId: "C-ops",
      threadTs: undefined,
      recipient: {
        channelId: "C-ops",
        threadTs: undefined,
        opsOnly: true,
      },
    });
    expect(partitions[1].items.map((item) => item.event.feature)).toEqual([
      "ops-health",
    ]);
  });

  it("preserves routed message thread_ts when all feature items in a channel share one thread", () => {
    const partitions = partitionAwayBatch([
      {
        event: { feature: "feat-alpha" },
        message: { text: "m1" },
        recipient: {
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W1",
          channelId: "C-alpha",
          actorUserId: "U-alice",
        },
        channelId: "C-alpha",
        threadTs: "1700000000.000555",
        opsOnly: false,
      },
    ]);

    expect(partitions).toHaveLength(1);
    expect(partitions[0].threadTs).toBe("1700000000.000555");
    expect(partitions[0].recipient?.threadTs).toBe("1700000000.000555");
  });
});
