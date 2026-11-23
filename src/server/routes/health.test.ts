/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fastify, { type FastifyInstance } from "fastify";
import { type Mocked, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrolledProject } from "../../domain/project-registry.js";
import type { NotificationPort } from "../../ports/notification-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import { healthRoutes } from "./health.js";

const { verifyEnrolledCheckoutMock } = vi.hoisted(() => ({
  verifyEnrolledCheckoutMock: vi.fn(),
}));

vi.mock("../slack.js", () => ({
  isSlackConnected: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../adapters/git/project-id.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../adapters/git/project-id.js")
  >("../../adapters/git/project-id.js");
  return {
    ...actual,
    verifyEnrolledCheckout: verifyEnrolledCheckoutMock,
  };
});

function makeRegistry(projects: EnrolledProject[]): ProjectRegistryPort {
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
    listRoleBindings: () => [],
    getFeatureThread: () => null,
    bindFeatureThread: (t) => t,
    getActionReceipt: () => null,
    claimActionReceipt: () => true,
    completeActionReceipt: () => true,
    close: () => {},
  };
}

describe("healthRoutes (FR-002, FR-005, TR-019)", () => {
  let server: FastifyInstance;
  let lifecycle: Mocked<LifecycleMonitor>;
  let network: Mocked<NetworkMonitor>;
  let sandbox: Mocked<SandboxManager>;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = fastify();
    lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as Mocked<LifecycleMonitor>;
    network = {
      isOnline: vi.fn().mockReturnValue(true),
    } as unknown as Mocked<NetworkMonitor>;
    sandbox = {
      checkGit: vi.fn().mockResolvedValue(true),
    } as unknown as Mocked<SandboxManager>;

    await healthRoutes(server, lifecycle, network, sandbox);
  });

  it("returns 200, ok status, daemonLiveness, unconfigured readiness, and disabled Telegram on /health and /api/health", async () => {
    for (const url of ["/health", "/api/health"]) {
      const response = await server.inject({ method: "GET", url });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.status).toBe("ok");
      expect(payload.daemonLiveness).toBe("alive");
      expect(payload.projectReadiness).toEqual({
        status: "unconfigured",
        readyCount: 0,
        totalCount: 0,
        projects: [],
      });
      expect(payload.slackDelivery).toEqual({
        mode: "socket_connected",
        connected: true,
      });
      expect(payload.telegram).toEqual({
        enabled: false,
        reason: "disabled_in_pilot",
      });
      expect(payload.components.server.status).toBe("ok");
      expect(payload.components.network.status).toBe("ok");
      expect(payload.components.git).toBeDefined();
      expect(payload.components.sandbox).toBeUndefined();
    }
  });

  it("TR-019: reports ready, degraded, and misconfigured project readiness alongside NotificationPort.getDeliveryStatus", async () => {
    const readyProject: EnrolledProject = {
      projectId: "proj-ready",
      slug: "ready-app",
      name: "Ready App",
      repoSlug: "org/ready-app",
      trunkBranch: "main",
      localRoot: "/repos/ready-app",
      mirrorPath: "/mirrors/ready-app",
      runnerPolicy: { allowedKinds: ["local", "hosted"] },
      slack: {
        workspaceId: "W1",
        channelId: "C-READY",
        opsChannelId: "C-OPS",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };

    const degradedProject: EnrolledProject = {
      projectId: "proj-degraded",
      slug: "degraded-app",
      name: "Degraded App",
      repoSlug: "org/degraded-app",
      trunkBranch: "develop",
      localRoot: "/repos/degraded-app",
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["hosted"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };

    const misconfiguredProject: EnrolledProject = {
      projectId: "proj-misconfigured",
      slug: "local-only-app",
      name: "Local Only App",
      repoSlug: "org/local-only",
      trunkBranch: "main",
      localRoot: "/repos/local-only",
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: {
        workspaceId: "W1",
        channelId: "C-LOCAL",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };

    verifyEnrolledCheckoutMock.mockImplementation(
      (project: EnrolledProject, key: "localRoot" | "mirrorPath") => {
        if (project.projectId === "proj-ready" && key === "mirrorPath") {
          return "/mirrors/ready-app";
        }
        if (project.projectId === "proj-degraded" && key === "localRoot") {
          return "/repos/degraded-app";
        }
        return undefined;
      },
    );

    const notifier: NotificationPort = {
      notify: vi.fn(),
      getDeliveryStatus: vi.fn().mockResolvedValue({
        mode: "degraded",
        workspaceId: "W1",
        connected: false,
        lastError: "socket disconnected",
      }),
    };

    const hostedServer = fastify();
    await healthRoutes(hostedServer, lifecycle, network, sandbox, {
      registry: makeRegistry([
        readyProject,
        degradedProject,
        misconfiguredProject,
      ]),
      notifier,
      runnerKind: "hosted",
    });

    const response = await hostedServer.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.daemonLiveness).toBe("alive");
    expect(body.status).toBe("degraded");
    expect(body.slackDelivery).toEqual({
      mode: "degraded",
      workspaceId: "W1",
      connected: false,
      lastError: "socket disconnected",
    });
    expect(body.telegram).toEqual({
      enabled: false,
      reason: "disabled_in_pilot",
    });
    expect(body.projectReadiness).toMatchObject({
      status: "degraded",
      readyCount: 1,
      totalCount: 3,
    });
    expect(body.projectReadiness.projects).toEqual([
      expect.objectContaining({
        projectId: "proj-ready",
        slug: "ready-app",
        checkoutReady: true,
        runnerAllowed: true,
        slackBound: true,
        status: "ready",
      }),
      expect.objectContaining({
        projectId: "proj-degraded",
        slug: "degraded-app",
        checkoutReady: true,
        runnerAllowed: true,
        slackBound: false,
        status: "degraded",
      }),
      expect.objectContaining({
        projectId: "proj-misconfigured",
        slug: "local-only-app",
        checkoutReady: false,
        runnerAllowed: false,
        slackBound: true,
        status: "misconfigured",
      }),
    ]);

    await hostedServer.close();
  });

  it("TR-019: reports projectReadiness.status as ready when every enrolled project is ready", async () => {
    const readyProject: EnrolledProject = {
      projectId: "proj-ready",
      slug: "ready-app",
      name: "Ready App",
      repoSlug: "org/ready-app",
      trunkBranch: "main",
      localRoot: "/repos/ready-app",
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: {
        workspaceId: "W1",
        channelId: "C-READY",
        sharedChannel: false,
      },
      legacyProjectIds: [],
      createdAt: "2026-11-18T00:00:00.000Z",
      updatedAt: "2026-11-18T00:00:00.000Z",
    };

    verifyEnrolledCheckoutMock.mockImplementation(
      (project: EnrolledProject, key: "localRoot" | "mirrorPath") =>
        project.projectId === "proj-ready" && key === "localRoot"
          ? "/repos/ready-app"
          : undefined,
    );

    const notifier: NotificationPort = {
      notify: vi.fn(),
      getDeliveryStatus: vi.fn().mockResolvedValue({
        mode: "socket_connected",
        workspaceId: "W1",
        connected: true,
      }),
    };

    const readyServer = fastify();
    await healthRoutes(readyServer, lifecycle, network, sandbox, {
      registry: makeRegistry([readyProject]),
      notifier,
      runnerKind: "local",
    });

    const response = await readyServer.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.daemonLiveness).toBe("alive");
    expect(body.projectReadiness).toMatchObject({
      status: "ready",
      readyCount: 1,
      totalCount: 1,
    });

    await readyServer.close();
  });
});
