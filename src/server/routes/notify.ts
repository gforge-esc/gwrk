/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../../domain/project-registry.js";
import {
  type RouteDenialCode,
  evaluateHttpProjectAccess,
} from "../../domain/slack-routing.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";
import type { AgentBackendId } from "../../utils/config.js";
import { resolveProjectId } from "../../utils/project-id.js";
import { MessageBuilder, type SlackMessage } from "../slack-messages.js";
import { notifySlack } from "../slack-notify.js";
import type { DispatchRecord, NotifyPayload } from "../types.js";

export interface NotifyRoutesOptions {
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

export async function notifyRoutes(
  server: FastifyInstance,
  options?: NotifyRoutesOptions,
) {
  server.post<{ Body: NotifyPayload }>(
    "/api/notify",
    async (request, reply) => {
      const payload = request.body;

      if (!payload || !payload.type || !payload.feature) {
        return reply.status(400).send({
          ok: false,
          error: "Missing required fields: type and feature are required",
        });
      }

      let authorizedProject: EnrolledProject | undefined;
      if (options?.registry || options?.transport === "hosted") {
        const projects = options.registry?.listProjects() ?? [];
        const roles = projects.flatMap(
          (project) =>
            options.registry?.listRoleBindings(project.projectId) ?? [],
        );
        const decision = evaluateHttpProjectAccess({
          projects,
          roles,
          requestedProject: payload.projectId ?? payload.recipient?.projectId,
          localDefaultProjectId: options.localDefaultProjectId,
          transport: options.transport ?? "trusted_local",
          principal: options.resolvePrincipal?.(request),
          requiredAccess: "operate",
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

        authorizedProject = decision.project;
        if (
          payload.recipient?.projectId &&
          payload.recipient.projectId !== authorizedProject.projectId
        ) {
          return reply.status(403).send({
            ok: false,
            code: "THREAD_PROJECT_MISMATCH",
            error: "Recipient project does not match authorized project.",
          });
        }
      }

      const hasConflictingOpsOnly =
        (payload.opsOnly !== undefined &&
          payload.recipient?.opsOnly !== undefined &&
          Boolean(payload.opsOnly) !== Boolean(payload.recipient.opsOnly)) ||
        (payload.type === "pulse" && payload.recipient?.opsOnly === false);
      if (authorizedProject && hasConflictingOpsOnly) {
        return reply.status(403).send({
          ok: false,
          code: "THREAD_PROJECT_MISMATCH",
          error: "Recipient opsOnly flag conflicts with notification scope.",
        });
      }

      const isOps =
        Boolean(payload.opsOnly) ||
        Boolean(payload.recipient?.opsOnly) ||
        payload.type === "pulse";

      if (authorizedProject && payload.recipient) {
        const slackBinding = authorizedProject.slack;
        if (
          payload.recipient.workspaceId &&
          (!slackBinding?.workspaceId ||
            payload.recipient.workspaceId !== slackBinding.workspaceId)
        ) {
          return reply.status(403).send({
            ok: false,
            code: "THREAD_PROJECT_MISMATCH",
            error: "Recipient workspace does not match authorized project.",
          });
        }

        if (payload.recipient.channelId) {
          const expectedChannelId = isOps
            ? slackBinding?.opsChannelId
            : slackBinding?.channelId;
          if (
            !expectedChannelId ||
            payload.recipient.channelId !== expectedChannelId
          ) {
            return reply.status(403).send({
              ok: false,
              code: "THREAD_PROJECT_MISMATCH",
              error: "Recipient channel does not match authorized project.",
            });
          }
        }
      }

      const notifyProjectId =
        authorizedProject?.projectId ??
        payload.projectId ??
        payload.recipient?.projectId;
      const projectRoot =
        authorizedProject?.mirrorPath ??
        authorizedProject?.localRoot ??
        process.cwd();
      const trunkBranch = authorizedProject?.trunkBranch ?? "develop";

      let resolvedRecipient: DeliveryRecipient | undefined;
      if (authorizedProject) {
        const slackBinding = authorizedProject.slack;
        const storedThread = !isOps
          ? (options?.registry?.getFeatureThread(
              authorizedProject.projectId,
              payload.feature,
            ) ?? null)
          : null;
        const validStoredThread =
          storedThread &&
          slackBinding &&
          storedThread.workspaceId === slackBinding.workspaceId &&
          storedThread.channelId === slackBinding.channelId
            ? storedThread
            : undefined;

        if (payload.recipient?.surface === "slack") {
          const { opsOnly: _ignoredOpsOnly, ...slackRecipientRest } =
            payload.recipient;
          resolvedRecipient = {
            ...slackRecipientRest,
            projectId: authorizedProject.projectId,
            surface: "slack",
            workspaceId:
              payload.recipient.workspaceId ?? slackBinding?.workspaceId,
            channelId:
              payload.recipient.channelId ??
              (isOps ? slackBinding?.opsChannelId : slackBinding?.channelId),
            threadTs: isOps
              ? undefined
              : (payload.recipient.threadTs ?? validStoredThread?.rootTs),
            ...(isOps ? { opsOnly: true } : {}),
          };
        } else if (slackBinding) {
          resolvedRecipient = {
            projectId: authorizedProject.projectId,
            surface: "slack",
            workspaceId: slackBinding.workspaceId,
            channelId: isOps
              ? slackBinding.opsChannelId
              : slackBinding.channelId,
            threadTs: isOps ? undefined : validStoredThread?.rootTs,
            ...(isOps ? { opsOnly: true } : {}),
          };
        }
      } else if (payload.recipient?.surface === "slack") {
        const { opsOnly: _ignoredOpsOnly, ...slackRecipientRest } =
          payload.recipient;
        resolvedRecipient = {
          ...slackRecipientRest,
          threadTs: isOps ? undefined : payload.recipient.threadTs,
          ...(isOps ? { opsOnly: true } : {}),
        };
      }

      const dispatch: DispatchRecord = {
        id: "notify-event",
        projectId: notifyProjectId ?? resolveProjectId(projectRoot),
        featureId: payload.feature,
        phaseId: payload.phase || "unknown",
        backend: (payload.backend as AgentBackendId) || "agy",
        status: "running",
        branchName: payload.branch || trunkBranch,
        projectRoot,
        trunkBranch,
        ...(resolvedRecipient ? { recipient: resolvedRecipient } : {}),
        attempts: [],
        tasks: [],
        createdAt: new Date().toISOString(),
        prUrl: payload.prUrl,
        prNumber: payload.prNumber,
      };

      let message: SlackMessage;
      switch (payload.type) {
        case "phase_start":
          message = MessageBuilder.phaseStart(dispatch);
          break;
        case "phase_complete":
          dispatch.status = "completed";
          message = MessageBuilder.phaseComplete(dispatch);
          break;
        case "phase_fail":
          dispatch.status = "failed";
          message = MessageBuilder.phaseFail(dispatch, payload.error);
          break;
        case "ci_result":
          message = MessageBuilder.ciResult(dispatch, {
            passed: !payload.error,
            summary: payload.gateResults || payload.error || "CI results ready",
          });
          break;
        case "review_ready":
          message = MessageBuilder.reviewReady(dispatch);
          break;
        case "done_done":
          message = MessageBuilder.doneDone(
            payload.feature,
            payload.compressionReport,
          );
          break;
        case "pulse":
          if (!payload.pulseReport) {
            return reply.status(400).send({
              ok: false,
              error: "Missing required field: pulseReport",
            });
          }
          message = MessageBuilder.pulseSummary(payload.pulseReport);
          break;
        case "define_spec_ready":
          if (!payload.specPath) {
            return reply.status(400).send({
              ok: false,
              error: "Missing required field: specPath",
            });
          }
          message = MessageBuilder.specReady(payload.feature, payload.specPath);
          break;
        case "define_plan_ready":
          if (!payload.planPath || !payload.phaseCount) {
            return reply.status(400).send({
              ok: false,
              error: "Missing required fields: planPath and phaseCount",
            });
          }
          message = MessageBuilder.planReady(
            payload.feature,
            payload.planPath,
            payload.phaseCount,
          );
          break;
        default:
          return reply.status(400).send({
            ok: false,
            error: `Unknown notification type: ${payload.type}`,
          });
      }

      try {
        await notifySlack(
          message,
          {
            type: payload.type,
            feature: payload.feature,
            phase: payload.phase,
            opsOnly: isOps,
            projectId: notifyProjectId,
            recipient: resolvedRecipient,
            payload: payload as unknown as Record<string, unknown>,
            timestamp: new Date().toISOString(),
          },
          {
            opsOnly: isOps,
            projectId: notifyProjectId,
            recipient: resolvedRecipient,
            featureId: payload.feature,
            registry: options?.registry,
          },
        );

        return { ok: true };
      } catch (error) {
        server.log.error(error);
        return reply.status(500).send({
          ok: false,
          error: `Failed to dispatch notification: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  );
}
