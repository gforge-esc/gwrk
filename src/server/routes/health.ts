/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyEnrolledCheckout } from "../../adapters/git/project-id.js";
import type {
  AllowedRunnerKind,
  EnrolledProject,
} from "../../domain/project-registry.js";
import {
  type RouteDenialCode,
  evaluateHttpProjectAccess,
} from "../../domain/slack-routing.js";
import type {
  NotificationPort,
  SlackDeliveryStatus,
} from "../../ports/notification-port.js";
import type {
  DurableOperationsStatus,
  OperationsStorePort,
} from "../../ports/operations-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import { isSlackConnected } from "../slack.js";
import { getTelegramStatus } from "../telegram.js";
import type { HealthResponse, ProjectReadinessReport } from "../types.js";

export interface HealthRoutesOptions {
  registry?: ProjectRegistryPort;
  operationsStore?: Pick<OperationsStorePort, "getOperationsStatus">;
  notifier?: NotificationPort;
  runnerKind?: AllowedRunnerKind;
  transport?: "trusted_local" | "hosted";
  localDefaultProjectId?: string;
  resolvePrincipal?: (request: FastifyRequest) =>
    | {
        principalType: "cli_token" | "google_sub";
        principalId: string;
      }
    | undefined;
}

export interface MinimalLivenessResponse {
  status: "ok" | "degraded";
  daemonLiveness: "alive";
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

export interface OutboxHealthSummary {
  status: "ok" | "degraded";
  pendingCount: number;
  uncertainCount: number;
  failedCount: number;
}

export interface HarvestHealthSummary {
  status: "ok" | "degraded";
  pendingOperations: number;
  unresolvedGateFailures: number;
  blockedCleanups: number;
  closedUnmergedCount: number;
}

export interface DurableProjectReadinessReport extends ProjectReadinessReport {
  operations?: {
    outbox: OutboxHealthSummary;
    harvest: HarvestHealthSummary;
  };
}

export interface DurableHealthResponse extends HealthResponse {
  projectReadiness: {
    status: "ready" | "degraded" | "unconfigured";
    readyCount: number;
    totalCount: number;
    projects: DurableProjectReadinessReport[];
  };
  outbox?: OutboxHealthSummary;
  harvest?: HarvestHealthSummary;
}

function summarizeProjectOperations(ops: DurableOperationsStatus): {
  outbox: OutboxHealthSummary;
  harvest: HarvestHealthSummary;
  degradationReasons: string[];
} {
  const outboxDegraded =
    ops.delivery.failedCount > 0 ||
    ops.delivery.uncertainCount > 0 ||
    ops.delivery.pendingCount > 0;
  const harvestDegraded =
    ops.harvest.unresolvedGateFailures > 0 || ops.harvest.blockedCleanups > 0;

  const degradationReasons: string[] = [];
  if (ops.harvest.unresolvedGateFailures > 0) {
    degradationReasons.push(
      `${ops.harvest.unresolvedGateFailures} unresolved harvest gate failure(s)`,
    );
  }
  if (ops.harvest.blockedCleanups > 0) {
    degradationReasons.push(
      `${ops.harvest.blockedCleanups} blocked branch cleanup(s)`,
    );
  }
  if (outboxDegraded) {
    degradationReasons.push(
      `outbox degraded (pending: ${ops.delivery.pendingCount}, uncertain: ${ops.delivery.uncertainCount}, failed: ${ops.delivery.failedCount})`,
    );
  }

  return {
    outbox: {
      status: outboxDegraded ? "degraded" : "ok",
      pendingCount: ops.delivery.pendingCount,
      uncertainCount: ops.delivery.uncertainCount,
      failedCount: ops.delivery.failedCount,
    },
    harvest: {
      status: harvestDegraded ? "degraded" : "ok",
      pendingOperations: ops.harvest.pendingOperations,
      unresolvedGateFailures: ops.harvest.unresolvedGateFailures,
      blockedCleanups: ops.harvest.blockedCleanups,
      closedUnmergedCount: ops.harvest.closedUnmergedCount,
    },
    degradationReasons,
  };
}

function evaluateProjectReadiness(
  project: EnrolledProject,
  runnerKind: AllowedRunnerKind,
  operations?: DurableOperationsStatus,
): DurableProjectReadinessReport {
  const runnerAllowed = project.runnerPolicy.allowedKinds.includes(runnerKind);
  const verifiedCheckout =
    verifyEnrolledCheckout(project, "mirrorPath") ??
    verifyEnrolledCheckout(project, "localRoot");
  const configuredCheckout = project.mirrorPath ?? project.localRoot;
  const checkoutPath = verifiedCheckout ?? configuredCheckout ?? null;
  const checkoutReady = Boolean(verifiedCheckout);
  const slackBound = Boolean(
    project.slack?.workspaceId && project.slack?.channelId,
  );
  const opsSummary = operations
    ? summarizeProjectOperations(operations)
    : undefined;

  let status: ProjectReadinessReport["status"];
  let reason: string | undefined;

  if (!configuredCheckout) {
    status = "misconfigured";
    reason = "No checkout path (localRoot or mirrorPath) configured";
  } else if (!runnerAllowed) {
    status = "misconfigured";
    reason = `Runner kind '${runnerKind}' is not allowed by project policy`;
  } else if (!checkoutReady) {
    status = "degraded";
    reason = `Configured checkout at '${configuredCheckout}' failed repository verification`;
  } else if (!slackBound) {
    status = "degraded";
    reason = "Project has no Slack workspace and channel binding";
  } else if (opsSummary && opsSummary.degradationReasons.length > 0) {
    status = "degraded";
    reason = opsSummary.degradationReasons.join("; ");
  } else {
    status = "ready";
  }

  return {
    projectId: project.projectId,
    slug: project.slug,
    repoSlug: project.repoSlug,
    trunkBranch: project.trunkBranch,
    checkoutPath,
    checkoutReady,
    runnerAllowed,
    slackBound,
    status,
    ...(reason ? { reason } : {}),
    ...(opsSummary
      ? {
          operations: {
            outbox: opsSummary.outbox,
            harvest: opsSummary.harvest,
          },
        }
      : {}),
  };
}

export async function healthRoutes(
  server: FastifyInstance,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  sandbox: SandboxManager,
  options?: HealthRoutesOptions,
) {
  const buildHealthResponse = async (
    scopedProjects?: readonly EnrolledProject[],
  ): Promise<DurableHealthResponse> => {
    const gitOk = await sandbox.checkGit();
    const networkOk = network.isOnline();
    const lifecycleStatus = lifecycle.getStatus();

    let slackDelivery: SlackDeliveryStatus;
    if (options?.notifier?.getDeliveryStatus) {
      slackDelivery = await options.notifier.getDeliveryStatus();
    } else {
      const slackOk = await isSlackConnected();
      slackDelivery = slackOk
        ? { mode: "socket_connected", connected: true }
        : { mode: "disabled", connected: false };
    }

    const runnerKind: AllowedRunnerKind = options?.runnerKind ?? "local";
    const enrolledProjects =
      scopedProjects ?? options?.registry?.listProjects() ?? [];
    const projectOperations = options?.operationsStore
      ? enrolledProjects.map((project) =>
          options.operationsStore?.getOperationsStatus(project.projectId),
        )
      : [];
    const projects = enrolledProjects.map((project, index) =>
      evaluateProjectReadiness(project, runnerKind, projectOperations[index]),
    );
    const totalCount = projects.length;
    const readyCount = projects.filter((p) => p.status === "ready").length;
    const readinessStatus: HealthResponse["projectReadiness"]["status"] =
      totalCount === 0
        ? "unconfigured"
        : readyCount === totalCount
          ? "ready"
          : "degraded";

    let outbox: OutboxHealthSummary | undefined;
    let harvest: HarvestHealthSummary | undefined;
    if (options?.operationsStore) {
      let pendingCount = 0;
      let uncertainCount = 0;
      let failedCount = 0;
      let pendingOperations = 0;
      let unresolvedGateFailures = 0;
      let blockedCleanups = 0;
      let closedUnmergedCount = 0;
      for (const ops of projectOperations) {
        if (!ops) continue;
        pendingCount += ops.delivery.pendingCount;
        uncertainCount += ops.delivery.uncertainCount;
        failedCount += ops.delivery.failedCount;
        pendingOperations += ops.harvest.pendingOperations;
        unresolvedGateFailures += ops.harvest.unresolvedGateFailures;
        blockedCleanups += ops.harvest.blockedCleanups;
        closedUnmergedCount += ops.harvest.closedUnmergedCount;
      }
      outbox = {
        status:
          pendingCount > 0 || uncertainCount > 0 || failedCount > 0
            ? "degraded"
            : "ok",
        pendingCount,
        uncertainCount,
        failedCount,
      };
      harvest = {
        status:
          unresolvedGateFailures > 0 || blockedCleanups > 0 ? "degraded" : "ok",
        pendingOperations,
        unresolvedGateFailures,
        blockedCleanups,
        closedUnmergedCount,
      };
    }

    const rawTelegram = getTelegramStatus();
    const telegram: HealthResponse["telegram"] = {
      enabled: false,
      reason: rawTelegram.reason ?? "disabled_in_pilot",
    };

    const components = {
      server: {
        status: lifecycleStatus === "degraded" ? "degraded" : "ok",
      } as const,
      git: {
        status: gitOk ? "ok" : "unavailable",
      } as const,
      network: {
        status: networkOk ? "ok" : "unavailable",
      } as const,
      slack: {
        status: slackDelivery.connected
          ? "ok"
          : slackDelivery.mode === "degraded"
            ? "degraded"
            : "unavailable",
        ...(slackDelivery.lastError
          ? { message: slackDelivery.lastError }
          : {}),
      } as const,
    };

    const overallStatus =
      components.server.status === "ok" &&
      components.git.status === "ok" &&
      components.network.status === "ok" &&
      components.slack.status === "ok" &&
      readinessStatus !== "degraded" &&
      (!outbox || outbox.status === "ok") &&
      (!harvest || harvest.status === "ok")
        ? "ok"
        : "degraded";

    return {
      status: overallStatus,
      daemonLiveness: "alive",
      projectReadiness: {
        status: readinessStatus,
        readyCount,
        totalCount,
        projects,
      },
      slackDelivery,
      telegram,
      ...(outbox ? { outbox } : {}),
      ...(harvest ? { harvest } : {}),
      components,
    };
  };

  if (options?.transport === "hosted") {
    server.get("/health", async (): Promise<MinimalLivenessResponse> => {
      const lifecycleStatus = lifecycle.getStatus();
      return {
        status: lifecycleStatus === "degraded" ? "degraded" : "ok",
        daemonLiveness: "alive",
      };
    });

    server.get<{ Querystring: { projectId?: string; project?: string } }>(
      "/api/health",
      async (request, reply) => {
        const requestedProject =
          request.query?.projectId ?? request.query?.project;
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
          transport: "hosted",
          principal: options.resolvePrincipal?.(request),
          requiredAccess: "read",
        });

        if (!decision.ok) {
          return reply.status(httpStatusForDenial(decision.code)).send({
            ok: false,
            code: decision.code,
            error: decision.message,
            requestId: request.id,
          });
        }

        return buildHealthResponse([decision.project]);
      },
    );
    return;
  }

  const localHandler = async (): Promise<DurableHealthResponse> =>
    buildHealthResponse();

  server.get("/health", localHandler);
  server.get("/api/health", localHandler);
}
