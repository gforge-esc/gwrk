/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance } from "fastify";
import { verifyEnrolledCheckout } from "../../adapters/git/project-id.js";
import type {
  AllowedRunnerKind,
  EnrolledProject,
} from "../../domain/project-registry.js";
import type {
  NotificationPort,
  SlackDeliveryStatus,
} from "../../ports/notification-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import { isSlackConnected } from "../slack.js";
import { getTelegramStatus } from "../telegram.js";
import type { HealthResponse, ProjectReadinessReport } from "../types.js";

export interface HealthRoutesOptions {
  registry?: ProjectRegistryPort;
  notifier?: NotificationPort;
  runnerKind?: AllowedRunnerKind;
}

function evaluateProjectReadiness(
  project: EnrolledProject,
  runnerKind: AllowedRunnerKind,
): ProjectReadinessReport {
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
  };
}

export async function healthRoutes(
  server: FastifyInstance,
  lifecycle: LifecycleMonitor,
  network: NetworkMonitor,
  sandbox: SandboxManager,
  options?: HealthRoutesOptions,
) {
  const handler = async (): Promise<HealthResponse> => {
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
    const enrolledProjects = options?.registry?.listProjects() ?? [];
    const projects = enrolledProjects.map((project) =>
      evaluateProjectReadiness(project, runnerKind),
    );
    const totalCount = projects.length;
    const readyCount = projects.filter((p) => p.status === "ready").length;
    const readinessStatus: HealthResponse["projectReadiness"]["status"] =
      totalCount === 0
        ? "unconfigured"
        : readyCount === totalCount
          ? "ready"
          : "degraded";

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
      readinessStatus !== "degraded"
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
      components,
    };
  };

  server.get("/health", handler);
  server.get("/api/health", handler);
}
