/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type RouteDenialCode,
  evaluateHttpProjectAccess,
} from "../../domain/slack-routing.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { DispatchQueue } from "../dispatch.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { SystemMonitor } from "../monitor.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import type { SandboxInfo, SystemStatus } from "../types.js";

const startTime = Date.now();

export interface StatusRoutesOptions {
  registry?: ProjectRegistryPort;
  transport?: "trusted_local" | "hosted";
  localDefaultProjectId?: string;
  resolvePrincipal?: (request: FastifyRequest) =>
    | {
        principalType: "cli_token" | "google_sub";
        principalId: string;
      }
    | undefined;
}

function httpStatusForDenial(code: RouteDenialCode): number {
  switch (code) {
    case "REMOTE_AUTH_REQUIRED":
      return 401;
    case "UNAUTHORIZED_USER":
    case "INSUFFICIENT_ROLE":
    case "RUNNER_NOT_ALLOWED":
      return 403;
    case "UNKNOWN_PROJECT":
      return 404;
    default:
      return 400;
  }
}

export async function getStatusData(
  monitor: SystemMonitor,
  queue: DispatchQueue,
  sandbox: SandboxManager,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  fastify?: FastifyInstance,
  options?: { projectId?: string; projectRoots?: readonly string[] },
): Promise<SystemStatus> {
  const stats = monitor.getResources();
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const allSandboxes = (await sandbox.listSandboxes()) as SandboxInfo[];
  const projectId = options?.projectId;

  let sandboxes = allSandboxes;
  if (projectId) {
    const activeForProject = queue.getQueue(projectId).active;
    const allActive = queue.getQueue().active;
    const activeWorkDirs = new Set(
      activeForProject
        .map((d) => d.workDir)
        .filter((dir): dir is string => Boolean(dir)),
    );
    const otherProjectWorkDirs = new Set(
      allActive
        .filter((d) => d.projectId !== projectId)
        .map((d) => d.workDir)
        .filter((dir): dir is string => Boolean(dir)),
    );
    const projectRoots = new Set<string>([
      ...(options?.projectRoots ?? []),
      ...activeForProject
        .map((d) => d.projectRoot)
        .filter((root): root is string => Boolean(root)),
    ]);

    sandboxes = allSandboxes.filter((sb) => {
      if (sb.projectId) {
        return sb.projectId === projectId;
      }
      if (activeWorkDirs.has(sb.workDir)) {
        return true;
      }
      if (otherProjectWorkDirs.has(sb.workDir)) {
        return false;
      }
      for (const root of projectRoots) {
        const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
        if (sb.workDir.startsWith(prefix)) {
          return true;
        }
      }
      return false;
    });
  }

  let port: number | undefined;
  if (fastify) {
    const address = fastify.server.address();
    port = address && typeof address === "object" ? address.port : undefined;
  }

  return {
    ...(projectId ? { projectId } : {}),
    server: {
      status: "running",
      lifecycle: lifecycle.getStatus(),
      pid: process.pid,
      uptime,
      port,
    },
    system: {
      cpuPercent: stats.cpuPercent,
      memPercent: stats.memPercent,
      diskFreeGb: stats.diskFreeGb,
    },
    network: {
      status: network.getStatus(),
    },
    dispatch: {
      queueDepth: queue.getQueueDepth(projectId),
      activeCount: queue.getActiveCount(projectId),
      completedCount: queue.getCompletedCount(projectId),
      failedCount: queue.getFailedCount(projectId),
      paused: queue.getQueue(projectId).paused,
    },
    sandboxes,
  };
}

export async function statusRoutes(
  fastify: FastifyInstance,
  monitor: SystemMonitor,
  queue: DispatchQueue,
  sandbox: SandboxManager,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  options?: StatusRoutesOptions,
) {
  fastify.get<{ Querystring: { projectId?: string; project?: string } }>(
    "/api/status",
    async (request, reply) => {
      const requestedProject =
        request.query?.projectId ?? request.query?.project;

      if (options?.registry || options?.transport === "hosted") {
        const projects = options.registry?.listProjects() ?? [];
        const roles = projects.flatMap(
          (project) =>
            options.registry?.listRoleBindings(project.projectId) ?? [],
        );
        const decision = evaluateHttpProjectAccess({
          projects,
          roles,
          requestedProject,
          localDefaultProjectId: options.localDefaultProjectId,
          transport: options.transport ?? "trusted_local",
          principal: options.resolvePrincipal?.(request),
          requiredAccess: "read",
        });

        if (!decision.ok) {
          return reply.status(httpStatusForDenial(decision.code)).send({
            ok: false,
            code: decision.code,
            error: decision.message,
            ...(decision.candidateSlugs
              ? { candidateSlugs: decision.candidateSlugs }
              : {}),
          });
        }

        const projectRoots = [
          decision.project.mirrorPath,
          decision.project.localRoot,
        ].filter((root): root is string => Boolean(root));

        return getStatusData(
          monitor,
          queue,
          sandbox,
          lifecycle,
          network,
          fastify,
          { projectId: decision.project.projectId, projectRoots },
        );
      }

      return getStatusData(
        monitor,
        queue,
        sandbox,
        lifecycle,
        network,
        fastify,
        requestedProject ? { projectId: requestedProject } : undefined,
      );
    },
  );
}
