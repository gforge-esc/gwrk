/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync } from "node:fs";
import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createServerFixture } from "../../../tests/helpers/server-fixture.js";
import type {
  EnrolledProject,
  ProjectRoleBinding,
} from "../../domain/project-registry.js";
import type {
  DurableOperationsStatus,
  OperationsStorePort,
} from "../../ports/operations-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { DispatchQueue } from "../dispatch.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { SystemMonitor } from "../monitor.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import type { DispatchRecord, SandboxInfo } from "../types.js";
import { statusRoutes } from "./status.js";

const alphaProject: EnrolledProject = {
  projectId: "proj-alpha",
  slug: "alpha",
  name: "Alpha",
  repoSlug: "org/alpha",
  trunkBranch: "main",
  localRoot: "/repos/alpha",
  mirrorPath: "/mirrors/alpha",
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "W1",
    channelId: "C-ALPHA",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

const betaProject: EnrolledProject = {
  projectId: "proj-beta",
  slug: "beta",
  name: "Beta",
  repoSlug: "org/beta",
  trunkBranch: "release",
  localRoot: "/repos/beta",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "W1",
    channelId: "C-BETA",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

function makeRegistry(
  projects: EnrolledProject[],
  roles: ProjectRoleBinding[] = [],
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
    getFeatureThread: () => null,
    bindFeatureThread: (t) => t,
    getActionReceipt: () => null,
    claimActionReceipt: () => true,
    completeActionReceipt: () => true,
    close: () => {},
  };
}

describe("status routes (FR-003, FR-004, FR-005, FR-006, TR-020)", () => {
  it("responds with status when the sandbox inventory is empty", async () => {
    const fixture = await createServerFixture("routes", { routes: ["status"] });
    try {
      const response = await fixture.app.inject({
        method: "GET",
        url: "/api/status",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.server.status).toBe("running");
      expect(body.server.lifecycle).toBe("ready");
      expect(body.server.pid).toBe(process.pid);
      expect(body.sandboxes).toEqual([]);
      expect(body.system.cpuPercent).toBeDefined();
      expect(body.system.memPercent).toBeDefined();
      expect(body.system.diskFreeGb).toBeDefined();
      expect(body.network.status).toBeDefined();
    } finally {
      await fixture.close();
    }
    expect(fixture.db.open).toBe(false);
    expect(existsSync(fixture.projectRoot)).toBe(false);
  });

  it("TR-020: filters dispatch counts and sandboxes by authorized projectId and denies unauthorized, unauthenticated, or ambiguous requests", async () => {
    const alphaDispatch: DispatchRecord = {
      id: "disp-alpha-1",
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      backend: "claude",
      status: "running",
      branchName: "feat/048-shared-phase-01",
      projectRoot: "/mirrors/alpha",
      trunkBranch: "main",
      workDir: "/mirrors/alpha/.runs/sandboxes/048-shared-ship-aaa11111",
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T00:00:00.000Z",
    };
    const betaDispatch: DispatchRecord = {
      id: "disp-beta-1",
      projectId: "proj-beta",
      featureId: "048-shared",
      phaseId: "phase-01",
      backend: "agy",
      status: "running",
      branchName: "feat/048-shared-phase-01",
      projectRoot: "/repos/beta",
      trunkBranch: "release",
      workDir: "/repos/beta/.runs/sandboxes/048-shared-ship-bbb22222",
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T00:00:00.000Z",
    };

    const monitor = {
      getResources: vi
        .fn()
        .mockReturnValue({ cpuPercent: 10, memPercent: 20, diskFreeGb: 50 }),
    } as unknown as SystemMonitor;
    const lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as LifecycleMonitor;
    const network = {
      getStatus: vi.fn().mockReturnValue("online"),
    } as unknown as NetworkMonitor;

    const queue = {
      getQueue: vi.fn((projectId?: string) => ({
        active:
          projectId === "proj-alpha"
            ? [alphaDispatch]
            : projectId === "proj-beta"
              ? [betaDispatch]
              : [alphaDispatch, betaDispatch],
        queued: [],
        throttled: false,
        paused: false,
      })),
      getQueueDepth: vi.fn((projectId?: string) =>
        projectId === "proj-alpha" ? 2 : projectId === "proj-beta" ? 5 : 7,
      ),
      getActiveCount: vi.fn((projectId?: string) =>
        projectId === "proj-alpha" ? 1 : projectId === "proj-beta" ? 3 : 4,
      ),
      getCompletedCount: vi.fn((projectId?: string) =>
        projectId === "proj-alpha" ? 4 : projectId === "proj-beta" ? 9 : 13,
      ),
      getFailedCount: vi.fn((projectId?: string) =>
        projectId === "proj-alpha" ? 0 : projectId === "proj-beta" ? 2 : 2,
      ),
    } as unknown as DispatchQueue;

    const allSandboxes: SandboxInfo[] = [
      {
        projectId: "proj-alpha",
        workDir: "/mirrors/alpha/.runs/sandboxes/048-shared-ship-aaa11111",
        taskId: "ship",
        featureId: "048-shared",
        phaseId: "phase-01",
        backend: "claude",
        status: "running",
        startedAt: "2026-11-18T00:00:00.000Z",
      },
      {
        workDir: "/repos/beta/.runs/sandboxes/048-shared-ship-bbb22222",
        taskId: "ship",
        featureId: "048-shared",
        phaseId: "phase-01",
        backend: "agy",
        status: "running",
        startedAt: "2026-11-18T00:00:00.000Z",
      },
    ];
    const sandbox = {
      listSandboxes: vi.fn().mockResolvedValue(allSandboxes),
    } as unknown as SandboxManager;

    const registry = makeRegistry(
      [alphaProject, betaProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:alpha-viewer",
          role: "viewer",
        },
      ],
    );

    const hostedServer = fastify();
    await statusRoutes(
      hostedServer,
      monitor,
      queue,
      sandbox,
      lifecycle,
      network,
      {
        registry,
        transport: "hosted",
        resolvePrincipal: (req) => {
          const verified = req.headers["x-verified-test-sub"];
          return typeof verified === "string"
            ? { principalType: "google_sub", principalId: verified }
            : undefined;
        },
      },
    );

    const localServer = fastify();
    await statusRoutes(
      localServer,
      monitor,
      queue,
      sandbox,
      lifecycle,
      network,
      {
        registry,
        transport: "trusted_local",
      },
    );

    try {
      // Authorized Alpha viewer sees only Alpha counts and sandboxes
      const alphaRes = await hostedServer.inject({
        method: "GET",
        url: "/api/status?projectId=proj-alpha",
        headers: { "x-verified-test-sub": "iss:alpha-viewer" },
      });
      expect(alphaRes.statusCode).toBe(200);
      const alphaBody = alphaRes.json();
      expect(alphaBody.projectId).toBe("proj-alpha");
      expect(alphaBody.dispatch).toEqual({
        queueDepth: 2,
        activeCount: 1,
        completedCount: 4,
        failedCount: 0,
        paused: false,
      });
      expect(alphaBody.sandboxes).toHaveLength(1);
      expect(alphaBody.sandboxes[0].workDir).toContain("/mirrors/alpha/");

      // Alpha viewer trying to read Beta -> 403
      const forbiddenBeta = await hostedServer.inject({
        method: "GET",
        url: "/api/status?projectId=proj-beta",
        headers: { "x-verified-test-sub": "iss:alpha-viewer" },
      });
      expect(forbiddenBeta.statusCode).toBe(403);
      expect(forbiddenBeta.json().code).toBe("UNAUTHORIZED_USER");

      // Unauthenticated hosted request (even with spoofed headers) -> 401
      const unauth = await hostedServer.inject({
        method: "GET",
        url: "/api/status?projectId=proj-alpha",
        headers: { "x-forwarded-user": "iss:alpha-viewer" },
      });
      expect(unauth.statusCode).toBe(401);
      expect(unauth.json().code).toBe("REMOTE_AUTH_REQUIRED");

      // Ambiguous request with two enrolled projects and no selector -> 400
      const ambiguous = await localServer.inject({
        method: "GET",
        url: "/api/status",
      });
      expect(ambiguous.statusCode).toBe(400);
      expect(ambiguous.json().code).toBe("AMBIGUOUS_PROJECT_SELECTION");
    } finally {
      await hostedServer.close();
      await localServer.close();
    }
  });

  it("TR-020 regression: excludes another project's active sandbox even when it lives under the daemon checkout's .runs/sandboxes directory", async () => {
    const alphaDispatch: DispatchRecord = {
      id: "disp-alpha-1",
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      backend: "claude",
      status: "running",
      branchName: "feat/048-shared-phase-01",
      projectRoot: "/repos/alpha",
      trunkBranch: "main",
      workDir: "/repos/alpha/.runs/sandboxes/048-shared-ship-aaa11111",
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T00:00:00.000Z",
    };
    const betaDispatch: DispatchRecord = {
      id: "disp-beta-1",
      projectId: "proj-beta",
      featureId: "048-shared",
      phaseId: "phase-01",
      backend: "agy",
      status: "running",
      branchName: "feat/048-shared-phase-01",
      projectRoot: "/repos/beta",
      trunkBranch: "release",
      // Real SandboxManager creates worktrees under daemonRoot/.runs/sandboxes/
      workDir: "/repos/alpha/.runs/sandboxes/048-shared-ship-bbb22222",
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T00:00:00.000Z",
    };

    const monitor = {
      getResources: vi
        .fn()
        .mockReturnValue({ cpuPercent: 10, memPercent: 20, diskFreeGb: 50 }),
    } as unknown as SystemMonitor;
    const lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as LifecycleMonitor;
    const network = {
      getStatus: vi.fn().mockReturnValue("online"),
    } as unknown as NetworkMonitor;
    const queue = {
      getQueue: vi.fn((projectId?: string) => ({
        active:
          projectId === "proj-alpha"
            ? [alphaDispatch]
            : projectId === "proj-beta"
              ? [betaDispatch]
              : [alphaDispatch, betaDispatch],
        queued: [],
        throttled: false,
        paused: false,
      })),
      getQueueDepth: vi.fn().mockReturnValue(0),
      getActiveCount: vi.fn().mockReturnValue(1),
      getCompletedCount: vi.fn().mockReturnValue(0),
      getFailedCount: vi.fn().mockReturnValue(0),
    } as unknown as DispatchQueue;

    // SandboxManager.listSandboxes() does NOT populate projectId
    const allSandboxes: SandboxInfo[] = [
      {
        workDir: "/repos/alpha/.runs/sandboxes/048-shared-ship-aaa11111",
        taskId: "ship",
        featureId: "048-shared",
        phaseId: "phase-01",
        backend: "claude",
        status: "running",
        startedAt: "2026-11-18T00:00:00.000Z",
      },
      {
        workDir: "/repos/alpha/.runs/sandboxes/048-shared-ship-bbb22222",
        taskId: "ship",
        featureId: "048-shared",
        phaseId: "phase-01",
        backend: "agy",
        status: "running",
        startedAt: "2026-11-18T00:00:00.000Z",
      },
    ];
    const sandbox = {
      listSandboxes: vi.fn().mockResolvedValue(allSandboxes),
    } as unknown as SandboxManager;

    const registry = makeRegistry(
      [alphaProject, betaProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:alpha-viewer",
          role: "viewer",
        },
        {
          projectId: "proj-beta",
          principalType: "google_sub",
          principalId: "iss:beta-viewer",
          role: "viewer",
        },
      ],
    );

    const server = fastify();
    await statusRoutes(server, monitor, queue, sandbox, lifecycle, network, {
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
      const alphaRes = await server.inject({
        method: "GET",
        url: "/api/status?projectId=proj-alpha",
        headers: { "x-verified-test-sub": "iss:alpha-viewer" },
      });
      expect(alphaRes.statusCode).toBe(200);
      expect(alphaRes.json().sandboxes).toEqual([
        expect.objectContaining({
          workDir: "/repos/alpha/.runs/sandboxes/048-shared-ship-aaa11111",
        }),
      ]);

      const betaRes = await server.inject({
        method: "GET",
        url: "/api/status?projectId=proj-beta",
        headers: { "x-verified-test-sub": "iss:beta-viewer" },
      });
      expect(betaRes.statusCode).toBe(200);
      expect(betaRes.json().sandboxes).toEqual([
        expect.objectContaining({
          workDir: "/repos/alpha/.runs/sandboxes/048-shared-ship-bbb22222",
        }),
      ]);
    } finally {
      await server.close();
    }
  });

  it("T033: includes project-scoped DurableOperationsStatus with queue age, last harvest, pending stages, outbox lag, gate failures and legacy counts", async () => {
    const alphaOps: DurableOperationsStatus = {
      projectId: "proj-alpha",
      queue: {
        queuedCount: 2,
        activeCount: 1,
        oldestQueuedAt: "2026-11-23T11:55:00.000Z",
        staleLeasesReconciled: 1,
      },
      harvest: {
        lastCompletedAt: "2026-11-23T11:40:00.000Z",
        lastMergeCommitSha: "a".repeat(40),
        pendingOperations: 1,
        pendingStages: [
          {
            operationId: "harv-alpha-1",
            featureId: "049-shared",
            phaseId: "phase-01",
            stage: "slack_delivery",
            status: "uncertain",
          },
        ],
        unresolvedGateFailures: 1,
        closedUnmergedCount: 2,
        blockedCleanups: 1,
      },
      delivery: {
        pendingCount: 1,
        uncertainCount: 1,
        failedCount: 0,
        telegram: { enabled: false, reason: "disabled_in_pilot" },
      },
      historical: {
        legacyUnverifiedRuns: 3,
        legacyUnverifiedDispatches: 4,
      },
    };
    const betaOps: DurableOperationsStatus = {
      projectId: "proj-beta",
      queue: {
        queuedCount: 0,
        activeCount: 0,
        oldestQueuedAt: null,
        staleLeasesReconciled: 0,
      },
      harvest: {
        lastCompletedAt: null,
        lastMergeCommitSha: null,
        pendingOperations: 0,
        pendingStages: [],
        unresolvedGateFailures: 0,
        closedUnmergedCount: 1,
        blockedCleanups: 0,
      },
      delivery: {
        pendingCount: 0,
        uncertainCount: 0,
        failedCount: 0,
        telegram: { enabled: false, reason: "disabled_in_pilot" },
      },
      historical: {
        legacyUnverifiedRuns: 0,
        legacyUnverifiedDispatches: 0,
      },
    };

    const getOperationsStatus = vi.fn((projectId: string) =>
      projectId === "proj-alpha" ? alphaOps : betaOps,
    );
    const operationsStore = {
      getOperationsStatus,
    } as unknown as Pick<OperationsStorePort, "getOperationsStatus">;

    const monitor = {
      getResources: vi
        .fn()
        .mockReturnValue({ cpuPercent: 10, memPercent: 20, diskFreeGb: 50 }),
    } as unknown as SystemMonitor;
    const lifecycle = {
      getStatus: vi.fn().mockReturnValue("ready"),
    } as unknown as LifecycleMonitor;
    const network = {
      getStatus: vi.fn().mockReturnValue("online"),
    } as unknown as NetworkMonitor;
    const queue = {
      getQueue: vi.fn().mockReturnValue({
        active: [],
        queued: [],
        throttled: false,
        paused: false,
      }),
      getQueueDepth: vi.fn().mockReturnValue(0),
      getActiveCount: vi.fn().mockReturnValue(0),
      getCompletedCount: vi.fn().mockReturnValue(0),
      getFailedCount: vi.fn().mockReturnValue(0),
    } as unknown as DispatchQueue;
    const sandbox = {
      listSandboxes: vi.fn().mockResolvedValue([]),
    } as unknown as SandboxManager;

    const registry = makeRegistry(
      [alphaProject, betaProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:alpha-viewer",
          role: "viewer",
        },
        {
          projectId: "proj-beta",
          principalType: "google_sub",
          principalId: "iss:beta-viewer",
          role: "viewer",
        },
      ],
    );

    const server = fastify();
    await statusRoutes(server, monitor, queue, sandbox, lifecycle, network, {
      registry,
      operationsStore,
      transport: "hosted",
      resolvePrincipal: (req) => {
        const sub = req.headers["x-verified-test-sub"];
        return typeof sub === "string"
          ? { principalType: "google_sub", principalId: sub }
          : undefined;
      },
    });

    try {
      const alphaRes = await server.inject({
        method: "GET",
        url: "/api/status?project=alpha",
        headers: { "x-verified-test-sub": "iss:alpha-viewer" },
      });
      expect(alphaRes.statusCode).toBe(200);
      expect(getOperationsStatus).toHaveBeenCalledWith("proj-alpha");
      expect(alphaRes.json().operations).toEqual(alphaOps);

      const betaRes = await server.inject({
        method: "GET",
        url: "/api/status?project=beta",
        headers: { "x-verified-test-sub": "iss:beta-viewer" },
      });
      expect(betaRes.statusCode).toBe(200);
      expect(getOperationsStatus).toHaveBeenCalledWith("proj-beta");
      expect(betaRes.json().operations).toEqual(betaOps);

      // Unauthorized access still rejected without leaking operations
      getOperationsStatus.mockClear();
      const denied = await server.inject({
        method: "GET",
        url: "/api/status?project=beta",
        headers: { "x-verified-test-sub": "iss:alpha-viewer" },
      });
      expect(denied.statusCode).toBe(403);
      expect(getOperationsStatus).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
