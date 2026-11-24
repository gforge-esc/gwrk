/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { join } from "node:path";
import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
  fixtureGit,
} from "../../../tests/helpers/server-fixture.js";
import * as gwrkPaths from "../../adapters/config/paths.js";
import * as instanceLocks from "../../adapters/server/instance-lock.js";
import { createSqliteProjectRegistryAdapter } from "../../adapters/sqlite/index.js";
import { listRuns } from "../../db/runs.js";
import { computeProjectId } from "../../domain/project-id.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
  ProjectRoleBinding,
  SlackFeatureThread,
} from "../../domain/project-registry.js";
import { ShipOrchestrator } from "../../engine/ship-orchestrator.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import { GwrkConfigSchema } from "../../utils/config.js";
import type { DispatchQueue } from "../dispatch.js";
import { HarvestWatcher } from "../harvest-watcher.js";
import { startServer } from "../index.js";
import { SystemMonitor } from "../monitor.js";
import { dispatchRoutes } from "./dispatch.js";

vi.mock("../slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(),
}));
vi.mock("../../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/index.js")>()),
  getDb: () => {
    throw new Error("Unexpected access to the default SQLite connection");
  },
}));

describe("dispatch routes", () => {
  let fixture: ServerFixture;

  beforeEach(async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(false);
    vi.mocked(ShipOrchestrator).mockImplementation(
      () =>
        ({
          run: async () => 0,
          getResult: () => ({ prNumber: 42 }),
        }) as ShipOrchestrator,
    );
    fixture = await createServerFixture("routes", { routes: ["dispatch"] });
  });

  afterEach(async () => {
    try {
      await fixture?.close();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it("should enqueue a dispatch via POST /api/dispatch", async () => {
    const server = fixture.app;

    const response = await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.featureId).toBe("feat-1");
    expect(json.phaseId).toBe("phase-1");
    expect(json.status).toBeDefined();
  });

  it("should return the queue status via GET /api/dispatch/queue", async () => {
    const server = fixture.app;

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/queue",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.active).toBeDefined();
    expect(json.queued).toBeDefined();
  });

  it.each([
    {
      hosted: true,
      request: { backend: "unapproved-fixture", taskIds: ["T1", "T2"] },
      taskIds: ["T1", "T2"],
      backend: "fixture",
    },
    {
      hosted: true,
      request: { taskId: "T1" },
      taskIds: ["T1"],
      backend: "fixture",
    },
    {
      hosted: false,
      request: { backend: "explicit-fixture", taskId: "T1" },
      taskIds: ["T1"],
      backend: "explicit-fixture",
    },
  ])(
    "keeps hosted=$hosted backend selection scoped through server startup",
    async ({ hosted, request, taskIds, backend }) => {
      const priorFixture = fixture;
      vi.stubEnv("GWRK_APPROVED_AGENT", "fixture");
      vi.stubEnv("GWRK_RUNTIME_DIR", join(priorFixture.projectRoot, "runtime"));
      vi.spyOn(gwrkPaths, "usesHostedRuntime").mockReturnValue(hosted);
      vi.spyOn(HarvestWatcher.prototype, "runCheck").mockResolvedValue(
        undefined,
      );
      vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(true);
      const lock = { pid: process.pid, lockPath: "fixture", release: vi.fn() };
      vi.spyOn(instanceLocks, "acquireInstanceLock").mockReturnValue(lock);
      vi.spyOn(instanceLocks, "acquireLedgerLock").mockReturnValue(lock);
      try {
        if (hosted) {
          const registry = createSqliteProjectRegistryAdapter({
            db: priorFixture.db,
          });
          const enrolledId = computeProjectId({
            projectRoot: priorFixture.projectRoot,
            remoteOriginUrl: null,
            gitCommonDir: join(priorFixture.projectRoot, ".git"),
          });
          const nowIso = "2026-11-23T00:00:00.000Z";
          registry.enrollProject({
            projectId: enrolledId,
            slug: "hosted-fixture",
            name: "Hosted Fixture",
            repoSlug: null,
            trunkBranch: "develop",
            localRoot: priorFixture.projectRoot,
            mirrorPath: null,
            runnerPolicy: { allowedKinds: ["local", "hosted"] },
            slack: null,
            legacyProjectIds: [],
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          registry.setRoleBinding({
            projectId: enrolledId,
            principalType: "google_sub",
            principalId: "iss:hosted-op",
            role: "operator",
          });
          const config = GwrkConfigSchema.parse({
            project: { name: "hosted-fixture" },
            agents: { implement: "gemini" },
            server: {
              host: "127.0.0.1",
              port: 0,
              githubWebhookSecret: "fixture-secret",
              heartbeatIntervalMs: 100,
              networkCheckIntervalMs: 100,
            },
            parallelism: {
              local: { maxCpu: 100, maxMem: 100, minDiskGb: 1, maxClones: 2 },
            },
          });
          const hostedApp = await startServer(config, {
            handleSignals: false,
            projectRoot: priorFixture.projectRoot,
            ledger: { db: priorFixture.db, projectId: enrolledId },
            registry,
            pid: { writePid: vi.fn(), removePid: vi.fn() },
            resolvePrincipal: (req) => {
              const sub = req.headers["x-verified-test-sub"];
              return typeof sub === "string"
                ? { principalType: "google_sub", principalId: sub }
                : undefined;
            },
          });
          try {
            const unauth = await hostedApp.inject({
              method: "POST",
              url: "/api/dispatch",
              payload: {
                projectId: enrolledId,
                featureId: "feat-1",
                phaseId: "phase-1",
                ...request,
              },
            });
            expect(unauth.statusCode).toBe(401);
            expect(unauth.json().code).toBe("REMOTE_AUTH_REQUIRED");

            const response = await hostedApp.inject({
              method: "POST",
              url: "/api/dispatch",
              headers: { "x-verified-test-sub": "iss:hosted-op" },
              payload: {
                projectId: enrolledId,
                featureId: "feat-1",
                phaseId: "phase-1",
                ...request,
              },
            });
            expect(response.statusCode).toBe(201);
            expect(instanceLocks.acquireLedgerLock).toHaveBeenCalledWith(
              priorFixture.db.name,
              process.pid,
            );
            const receipt = response.json();
            expect(receipt.operationId).toBeDefined();
            const queue = await hostedApp.inject({
              method: "GET",
              url: `/api/dispatch/queue?projectId=${enrolledId}`,
              headers: { "x-verified-test-sub": "iss:hosted-op" },
            });
            expect(queue.statusCode).toBe(200);
            const record = queue.json().queued[0];
            expect(record.id).toBe(receipt.operationId);
            expect(record.backend).toBe(backend);
            expect(record.tasks).toMatchObject(
              taskIds.map((id) => ({ id, backend })),
            );
            expect(queue.json()).toMatchObject({
              active: [],
              queued: [record],
            });
          } finally {
            await hostedApp.close();
          }
        } else {
          fixture = await createServerFixture("listen");
          const response = await fixture.app.inject({
            method: "POST",
            url: "/api/dispatch",
            payload: { featureId: "feat-1", phaseId: "phase-1", ...request },
          });
          expect(response.statusCode).toBe(201);
          const record = response.json();
          expect(record.backend).toBe(backend);
          expect(record.tasks).toMatchObject(
            taskIds.map((id) => ({ id, backend })),
          );
          const queue = await fixture.app.inject("/api/dispatch/queue");
          expect(queue.statusCode).toBe(200);
          expect(queue.json()).toMatchObject({ active: [], queued: [record] });
        }
      } finally {
        await priorFixture.close();
      }
    },
  );

  it("should return a specific dispatch via GET /api/dispatch/:feature/:phase", async () => {
    const server = fixture.app;

    // First enqueue it
    await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/feat-1/phase-1",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.featureId).toBe("feat-1");
    expect(json.phaseId).toBe("phase-1");
  });
  it.each([
    { exitCode: 0, status: "completed" },
    { exitCode: 1, status: "failed" },
  ])(
    "persists a $status dispatch only in its fixture",
    async ({ exitCode, status }) => {
      vi.mocked(ShipOrchestrator).mockImplementationOnce(
        () =>
          ({
            run: async () => exitCode,
            getResult: () => ({}),
          }) as ShipOrchestrator,
      );
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "feat-1", phaseId: "phase-1" },
      });
      expect(response.statusCode).toBe(201);
      const { id } = response.json();

      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({ id, status });
      });
      expect(listRuns("feat-1", fixture.projectId, fixture.db)).toEqual([
        expect.objectContaining({
          exit_code: exitCode,
          finished_at: expect.any(String),
        }),
      ]);
      expect(
        fixtureGit(
          fixture.projectRoot,
          "worktree",
          "list",
          "--porcelain",
        ).match(/^worktree /gm),
      ).toHaveLength(1);
      expect(fixtureGit(fixture.projectRoot, "remote")).toBe("");
    },
  );
});

describe("TR-023: /api/dispatch HTTP project access enforcement", () => {
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
      workspaceId: "W-ALPHA",
      channelId: "C-ALPHA",
      opsChannelId: "C-ALPHA-OPS",
      sharedChannel: false,
    },
    legacyProjectIds: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
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
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
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
      findByRepoSlug: (slug) =>
        projects.find((p) => p.repoSlug === slug) ?? null,
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

  it("denies remote /api/dispatch calls without verified principal or sufficient role and permits authorized hosted and local enrolled calls", async () => {
    const registry = makeRegistry(
      [alphaProject, betaLocalOnlyProject],
      [
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:viewer",
          role: "viewer",
        },
        {
          projectId: "proj-alpha",
          principalType: "google_sub",
          principalId: "iss:operator",
          role: "operator",
        },
        {
          projectId: "proj-beta",
          principalType: "google_sub",
          principalId: "iss:operator",
          role: "operator",
        },
      ],
    );

    const enqueued: Array<{
      projectId?: string;
      featureId: string;
      phaseId: string;
      recipient?: DeliveryRecipient;
    }> = [];
    const mockQueue = {
      enqueue: vi.fn((req) => {
        enqueued.push(req);
        return {
          id: `disp-${enqueued.length}`,
          projectId: req.projectId ?? "unknown",
          featureId: req.featureId,
          phaseId: req.phaseId,
          backend: "claude",
          status: "queued",
          branchName: `feat/${req.featureId}-${req.phaseId}`,
          projectRoot: "/mirrors/alpha",
          trunkBranch: "main",
          ...(req.recipient ? { recipient: req.recipient } : {}),
          attempts: [],
          tasks: [],
          createdAt: "2026-11-23T00:00:00.000Z",
        };
      }),
      getQueue: vi.fn((projectId?: string) => ({
        active: [],
        queued: enqueued.filter((e) => !projectId || e.projectId === projectId),
        throttled: false,
        paused: false,
      })),
      getDispatch: vi.fn(
        (
          featureId: string,
          phaseId: string,
          _taskId?: string,
          projectId?: string,
        ) =>
          enqueued.find(
            (e) =>
              e.featureId === featureId &&
              e.phaseId === phaseId &&
              (!projectId || e.projectId === projectId),
          ) ?? null,
      ),
    } as unknown as DispatchQueue;

    const hostedServer = fastify();
    await dispatchRoutes(hostedServer, mockQueue, {
      registry,
      transport: "hosted",
      resolvePrincipal: (req) => {
        const sub = req.headers["x-verified-test-sub"];
        return typeof sub === "string"
          ? { principalType: "google_sub", principalId: sub }
          : undefined;
      },
    });

    const localServer = fastify();
    await dispatchRoutes(localServer, mockQueue, {
      registry,
      transport: "trusted_local",
      localDefaultProjectId: "proj-beta",
    });

    try {
      // Unauthenticated hosted call (even with spoofed headers) -> 401
      const unauth = await hostedServer.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          "x-forwarded-user": "iss:operator",
          "x-forwarded-for": "127.0.0.1",
        },
        payload: {
          projectId: "proj-alpha",
          featureId: "048-shared",
          phaseId: "phase-06",
        },
      });
      expect(unauth.statusCode).toBe(401);
      expect(unauth.json().code).toBe("REMOTE_AUTH_REQUIRED");

      // Viewer role cannot operate -> 403
      const viewerDenied = await hostedServer.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:viewer" },
        payload: {
          projectId: "proj-alpha",
          featureId: "048-shared",
          phaseId: "phase-06",
        },
      });
      expect(viewerDenied.statusCode).toBe(403);
      expect(viewerDenied.json().code).toBe("INSUFFICIENT_ROLE");

      // Local-only project denies hosted runner -> 403
      const runnerDenied = await hostedServer.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          projectId: "proj-beta",
          featureId: "048-shared",
          phaseId: "phase-06",
        },
      });
      expect(runnerDenied.statusCode).toBe(403);
      expect(runnerDenied.json().code).toBe("RUNNER_NOT_ALLOWED");

      // Cross-project recipient mismatch -> 403
      const mismatch = await hostedServer.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          projectId: "proj-alpha",
          featureId: "048-shared",
          phaseId: "phase-06",
          recipient: {
            projectId: "proj-beta",
            surface: "slack",
            workspaceId: "W-BETA",
            channelId: "C-BETA",
          },
        },
      });
      expect(mismatch.statusCode).toBe(403);
      expect(mismatch.json().code).toBe("THREAD_PROJECT_MISMATCH");

      // Authorized hosted operator succeeds and forwards canonical projectId and derived recipient
      const okHosted = await hostedServer.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          projectId: "alpha",
          featureId: "048-shared",
          phaseId: "phase-06",
        },
      });
      expect(okHosted.statusCode).toBe(201);
      expect(mockQueue.enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectId: "proj-alpha",
          featureId: "048-shared",
          phaseId: "phase-06",
          recipient: {
            projectId: "proj-alpha",
            surface: "http",
          },
        }),
      );

      // Explicit null recipient stays distinct from omitted recipient
      const nullRecipient = await hostedServer.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: { "x-verified-test-sub": "iss:operator" },
        payload: {
          projectId: "proj-alpha",
          featureId: "048-shared",
          phaseId: "phase-07",
          recipient: null,
        },
      });
      expect(nullRecipient.statusCode).toBe(201);
      expect(mockQueue.enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectId: "proj-alpha",
          featureId: "048-shared",
          phaseId: "phase-07",
          recipient: null,
        }),
      );

      // Viewer can read scoped queue and dispatch records
      const viewerQueue = await hostedServer.inject({
        method: "GET",
        url: "/api/dispatch/queue?projectId=proj-alpha",
        headers: { "x-verified-test-sub": "iss:viewer" },
      });
      expect(viewerQueue.statusCode).toBe(200);
      expect(mockQueue.getQueue).toHaveBeenCalledWith("proj-alpha");

      const viewerGet = await hostedServer.inject({
        method: "GET",
        url: "/api/dispatch/048-shared/phase-06?projectId=proj-alpha",
        headers: { "x-verified-test-sub": "iss:viewer" },
      });
      expect(viewerGet.statusCode).toBe(200);
      expect(mockQueue.getDispatch).toHaveBeenCalledWith(
        "048-shared",
        "phase-06",
        undefined,
        "proj-alpha",
      );

      // Trusted local call resolves localDefaultProjectId without remote principal
      const localRes = await localServer.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "048-shared",
          phaseId: "phase-06",
        },
      });
      expect(localRes.statusCode).toBe(201);
      expect(mockQueue.enqueue).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectId: "proj-beta",
          recipient: {
            projectId: "proj-beta",
            surface: "local_cli",
          },
        }),
      );
    } finally {
      await hostedServer.close();
      await localServer.close();
    }
  });
});
