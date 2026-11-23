/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnrolledProject,
  ProjectRoleBinding,
  SlackFeatureThread,
} from "../../domain/project-registry.js";
import { evaluateSlackAction } from "../../domain/slack-routing.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import * as slackNotify from "../slack-notify.js";
import { notifyRoutes } from "./notify.js";

vi.mock("../slack-notify.js");

const alphaHostedProject: EnrolledProject = {
  projectId: "proj-alpha",
  slug: "alpha",
  name: "Alpha",
  repoSlug: "org/alpha",
  trunkBranch: "main",
  localRoot: "/repos/alpha",
  mirrorPath: "/mirrors/alpha",
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "W-ALPHA",
    channelId: "C-ALPHA",
    opsChannelId: "C-ALPHA-OPS",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

const betaLocalOnlyProject: EnrolledProject = {
  projectId: "proj-beta",
  slug: "beta",
  name: "Beta",
  repoSlug: "org/beta",
  trunkBranch: "develop",
  localRoot: "/repos/beta",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: {
    workspaceId: "W-BETA",
    channelId: "C-BETA",
    opsChannelId: "C-BETA-OPS",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

function makeRegistry(
  projects: EnrolledProject[],
  roles: ProjectRoleBinding[] = [],
  threads: Record<string, SlackFeatureThread> = {},
): ProjectRegistryPort {
  return {
    enrollProject: (p) => p,
    getProject: (id) =>
      projects.find((p) => p.projectId === id || p.slug === id) ?? null,
    findByRepoSlug: (slug) => projects.find((p) => p.repoSlug === slug) ?? null,
    findByLocalRoot: (root) =>
      projects.find((p) => p.localRoot === root) ?? null,
    listBySlackChannel: () => [],
    listProjects: () => projects,
    setRoleBinding: () => {},
    listRoleBindings: (projectId) =>
      roles.filter((r) => r.projectId === projectId),
    getFeatureThread: (projectId, featureId) =>
      threads[`${projectId}:${featureId}`] ?? null,
    bindFeatureThread: (t) => t,
    getActionReceipt: () => null,
    claimActionReceipt: () => true,
    completeActionReceipt: () => true,
    close: () => {},
  };
}

describe("notify routes (FR-003, FR-005, FR-007, TR-018)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-003, US-007: posts a notification via POST /api/notify", async () => {
    const server = fastify();
    await notifyRoutes(server);
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      const response = await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
          feature: "test-feature",
          phase: "phase-1",
          backend: "gemini",
          branch: "main",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(spy).toHaveBeenCalled();

      const callArgs = spy.mock.calls[0];
      expect(callArgs[0].text).toContain(
        "Phase phase-1 started for test-feature",
      );
      expect(callArgs[1]?.type).toBe("phase_start");
    } finally {
      await server.close();
    }
  });

  it("FR-003, US-003: returns 400 for missing required fields", async () => {
    const server = fastify();
    await notifyRoutes(server);
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().ok).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("FR-004, US-004: forwards explicit opsOnly flag", async () => {
    const server = fastify();
    await notifyRoutes(server);
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
          feature: "test-feature",
          opsOnly: true,
        },
      });

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][2]?.opsOnly).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("FR-016: handles define_spec_ready and define_plan_ready notifications", async () => {
    const server = fastify();
    await notifyRoutes(server);
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "define_spec_ready",
          feature: "003-slack",
          specPath: "specs/003-slack/spec.md",
        },
      });
      expect(spy.mock.calls[0][0].text).toContain("Spec Ready");
      expect(spy.mock.calls[0][0].text).toContain("003-slack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "define_plan_ready",
          feature: "003-slack",
          planPath: "specs/003-slack/plan.md",
          phaseCount: 5,
        },
      });
      expect(spy.mock.calls[1][0].text).toContain("Plan Ready");
      expect(spy.mock.calls[1][0].text).toContain("5 phases");
    } finally {
      await server.close();
    }
  });

  it("TR-018: keeps done_done on the feature thread by default and uses opsOnly only when explicitly set", async () => {
    const server = fastify();
    await notifyRoutes(server);
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      const defaultRes = await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "done_done",
          feature: "003-slack",
        },
      });
      expect(defaultRes.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][2]?.opsOnly).toBe(false);

      const opsRes = await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "done_done",
          feature: "003-slack",
          opsOnly: true,
        },
      });
      expect(opsRes.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1][2]?.opsOnly).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("routes pulse to ops channel", async () => {
    const server = fastify();
    await notifyRoutes(server);
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "pulse",
          feature: "003-slack",
          pulseReport: {
            generatedAt: new Date().toISOString(),
            repositories: [],
            specProgress: { totalSpecs: 10, totalPlans: 5 },
          },
        },
      });

      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][2]?.opsOnly).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("TR-018: denies unauthenticated hosted calls (ignoring spoofed x-forwarded-* headers) and insufficient roles or disallowed runners", async () => {
    const registry = makeRegistry(
      [alphaHostedProject, betaLocalOnlyProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:viewer",
          role: "viewer",
        },
        {
          projectId: "proj-beta",
          principalType: "google_sub",
          principalId: "iss:operator",
          role: "operator",
        },
      ],
    );

    const server = fastify();
    await notifyRoutes(server, {
      registry,
      transport: "hosted",
      resolvePrincipal: (req) => {
        const verified = req.headers["x-verified-test-sub"];
        return typeof verified === "string"
          ? { principalType: "google_sub", principalId: verified }
          : undefined;
      },
    });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      // Missing verified principal even with spoofed forwarded headers -> 401
      const unauth = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: {
          "x-forwarded-user": "iss:operator",
          "x-forwarded-email": "admin@example.com",
          "x-forwarded-for": "127.0.0.1",
        },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
        },
      });
      expect(unauth.statusCode).toBe(401);
      expect(unauth.json().code).toBe("REMOTE_AUTH_REQUIRED");

      // Viewer role lacks 'operate' permission -> 403
      const insufficient = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:viewer" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
        },
      });
      expect(insufficient.statusCode).toBe(403);
      expect(insufficient.json().code).toBe("INSUFFICIENT_ROLE");

      // Local-only project rejects hosted runner -> 403
      const runnerBlocked = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-beta",
        },
      });
      expect(runnerBlocked.statusCode).toBe(403);
      expect(runnerBlocked.json().code).toBe("RUNNER_NOT_ALLOWED");

      // Unknown project -> 404
      const unknown = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-missing",
        },
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().code).toBe("UNKNOWN_PROJECT");

      expect(spy).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("TR-018: accepts authorized hosted and trusted_local notifications and forwards projectId, recipient, and registry to notifySlack", async () => {
    const thread: SlackFeatureThread = {
      projectId: "proj-alpha",
      featureId: "048-shared",
      workspaceId: "W-ALPHA",
      channelId: "C-ALPHA",
      rootTs: "1700000100.000200",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const registry = makeRegistry(
      [alphaHostedProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:operator",
          role: "operator",
        },
      ],
      { "proj-alpha:048-shared": thread },
    );

    const hostedServer = fastify();
    await notifyRoutes(hostedServer, {
      registry,
      transport: "hosted",
      resolvePrincipal: (req) => {
        const verified = req.headers["x-verified-test-sub"];
        return typeof verified === "string"
          ? { principalType: "google_sub", principalId: verified }
          : undefined;
      },
    });
    const localServer = fastify();
    await notifyRoutes(localServer, {
      registry,
      transport: "trusted_local",
      localDefaultProjectId: "proj-alpha",
    });

    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      const hostedRes = await hostedServer.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
        },
      });
      expect(hostedRes.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: "done_done",
          feature: "048-shared",
          opsOnly: false,
          projectId: "proj-alpha",
          recipient: expect.objectContaining({
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-ALPHA",
            threadTs: "1700000100.000200",
          }),
        }),
        expect.objectContaining({
          opsOnly: false,
          projectId: "proj-alpha",
          featureId: "048-shared",
          registry,
          recipient: expect.objectContaining({
            projectId: "proj-alpha",
            channelId: "C-ALPHA",
            threadTs: "1700000100.000200",
          }),
        }),
      );

      const localRes = await localServer.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
          feature: "048-shared",
          phase: "phase-05",
        },
      });
      expect(localRes.statusCode).toBe(200);
      expect(spy).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: "phase_start",
          projectId: "proj-alpha",
        }),
        expect.objectContaining({
          projectId: "proj-alpha",
          featureId: "048-shared",
          registry,
        }),
      );
    } finally {
      await hostedServer.close();
      await localServer.close();
    }
  });

  it("TR-018 regression: rejects cross-channel, cross-workspace, and ops/feature channel-mismatched caller recipients", async () => {
    const registry = makeRegistry(
      [alphaHostedProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:operator",
          role: "operator",
        },
      ],
    );

    const hostedServer = fastify();
    await notifyRoutes(hostedServer, {
      registry,
      transport: "hosted",
      resolvePrincipal: (req) => {
        const verified = req.headers["x-verified-test-sub"];
        return typeof verified === "string"
          ? { principalType: "google_sub", principalId: verified }
          : undefined;
      },
    });

    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      // Alpha operator attempting to hijack Beta's channel via recipient.channelId -> 403
      const crossChannel = await hostedServer.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
          recipient: {
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-BETA",
            threadTs: "1700000999.000100",
          },
        },
      });
      expect(crossChannel.statusCode).toBe(403);
      expect(crossChannel.json().code).toBe("THREAD_PROJECT_MISMATCH");

      // Alpha operator attempting to target another workspace -> 403
      const crossWorkspace = await hostedServer.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
          recipient: {
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-OTHER",
            channelId: "C-ALPHA",
          },
        },
      });
      expect(crossWorkspace.statusCode).toBe(403);
      expect(crossWorkspace.json().code).toBe("THREAD_PROJECT_MISMATCH");

      // opsOnly notification targeting feature channel instead of opsChannelId -> 403
      const wrongOpsChannel = await hostedServer.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
          opsOnly: true,
          recipient: {
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-ALPHA",
          },
        },
      });
      expect(wrongOpsChannel.statusCode).toBe(403);
      expect(wrongOpsChannel.json().code).toBe("THREAD_PROJECT_MISMATCH");

      // Conflicting payload.opsOnly vs recipient.opsOnly -> 403
      const conflictingOps = await hostedServer.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
          opsOnly: false,
          recipient: {
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-ALPHA-OPS",
            opsOnly: true,
          },
        },
      });
      expect(conflictingOps.statusCode).toBe(403);
      expect(conflictingOps.json().code).toBe("THREAD_PROJECT_MISMATCH");

      expect(spy).not.toHaveBeenCalled();

      // Non-Slack recipient surface derives Slack recipient from project binding instead of forwarding non-Slack surface
      const nonSlackRecipient = await hostedServer.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "done_done",
          feature: "048-shared",
          projectId: "proj-alpha",
          recipient: {
            projectId: "proj-alpha",
            surface: "http",
          },
        },
      });
      expect(nonSlackRecipient.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId: "proj-alpha",
          recipient: expect.objectContaining({
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-ALPHA",
          }),
        }),
        expect.objectContaining({
          projectId: "proj-alpha",
          recipient: expect.objectContaining({
            projectId: "proj-alpha",
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-ALPHA",
          }),
        }),
      );
    } finally {
      await hostedServer.close();
    }
  });

  it("TR-018 UAT regression: stamps projectId, projectSlug, and rootTs on interactive notify cards so shared-channel clicks authorize", async () => {
    const sharedAlpha: EnrolledProject = {
      ...alphaHostedProject,
      slack: {
        workspaceId: "W-SHARED",
        channelId: "C-SHARED",
        opsChannelId: "C-ALPHA-OPS",
        sharedChannel: true,
      },
    };
    const sharedBeta: EnrolledProject = {
      ...betaLocalOnlyProject,
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W-SHARED",
        channelId: "C-SHARED",
        opsChannelId: "C-BETA-OPS",
        sharedChannel: true,
      },
    };
    const storedThread: SlackFeatureThread = {
      projectId: "proj-alpha",
      featureId: "048-shared",
      workspaceId: "W-SHARED",
      channelId: "C-SHARED",
      rootTs: "1700000100.000200",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };
    const roles: ProjectRoleBinding[] = [
      {
        projectId: "proj-alpha",
        principalType: "google_sub",
        principalId: "iss:operator",
        role: "operator",
      },
      {
        projectId: "proj-alpha",
        principalType: "slack_user",
        principalId: "W-SHARED:U-MAINT",
        role: "maintainer",
      },
    ];
    const registry = makeRegistry([sharedAlpha, sharedBeta], roles, {
      "proj-alpha:048-shared": storedThread,
    });

    const server = fastify();
    await notifyRoutes(server, {
      registry,
      transport: "hosted",
      resolvePrincipal: (req) => {
        const verified = req.headers["x-verified-test-sub"];
        return typeof verified === "string"
          ? { principalType: "google_sub", principalId: verified }
          : undefined;
      },
    });

    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      const specRes = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "define_spec_ready",
          projectId: "proj-alpha",
          feature: "048-shared",
          specPath: "specs/048-shared/spec.md",
        },
      });
      expect(specRes.statusCode).toBe(200);

      const planRes = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "define_plan_ready",
          projectId: "proj-alpha",
          feature: "048-shared",
          planPath: "specs/048-shared/plan.md",
          phaseCount: 5,
        },
      });
      expect(planRes.statusCode).toBe(200);

      const reviewRes = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "review_ready",
          projectId: "proj-alpha",
          feature: "048-shared",
          phase: "phase-05",
          prNumber: 77,
          prUrl: "https://github.com/org/alpha/pull/77",
        },
      });
      expect(reviewRes.statusCode).toBe(200);

      const failRes = await server.inject({
        method: "POST",
        url: "/api/notify",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          type: "phase_fail",
          projectId: "proj-alpha",
          feature: "048-shared",
          phase: "phase-05",
          error: "gate failed",
        },
      });
      expect(failRes.statusCode).toBe(200);

      const extractFirstAction = (callIndex: number) => {
        const message = spy.mock.calls[callIndex][0];
        const actionsBlock = message.blocks.find(
          (
            b,
          ): b is {
            type: "actions";
            elements: Array<{ action_id: string; value?: string }>;
          } => b.type === "actions",
        );
        expect(actionsBlock).toBeDefined();
        const button = actionsBlock?.elements[0];
        expect(button?.value).toBeDefined();
        return {
          actionId: button?.action_id ?? "",
          parsed: JSON.parse(button?.value ?? "{}") as {
            projectId?: string;
            projectSlug?: string;
            rootTs?: string;
            featureId?: string;
            phaseId?: string;
          },
        };
      };

      for (const [callIndex, expectedActionId, requiredAccess] of [
        [0, "approve_spec", "maintain"],
        [1, "approve_plan", "maintain"],
        [2, "merge_pr", "maintain"],
        [3, "retry_phase", "operate"],
      ] as const) {
        const { actionId, parsed } = extractFirstAction(callIndex);
        expect(actionId).toBe(expectedActionId);

        const decision = evaluateSlackAction([sharedAlpha, sharedBeta], roles, {
          workspaceId: "W-SHARED",
          channelId: "C-SHARED",
          isDirectMessage: false,
          actorUserId: "U-MAINT",
          threadTs: storedThread.rootTs,
          messageTs: "1700000200.000300",
          actionId,
          payloadProjectId: parsed.projectId,
          payloadRootTs: parsed.rootTs,
          featureId: parsed.featureId ?? "",
          phaseId: parsed.phaseId,
          requiredAccess,
          storedThread,
          priorReceipt: null,
        });
        expect(decision).toMatchObject({
          ok: true,
          project: expect.objectContaining({ projectId: "proj-alpha" }),
        });
        expect(parsed).toMatchObject({
          projectId: "proj-alpha",
          projectSlug: "alpha",
          rootTs: "1700000100.000200",
          featureId: "048-shared",
        });
      }
    } finally {
      await server.close();
    }
  });
});
