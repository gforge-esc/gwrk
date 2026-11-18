/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type DeliveryRecipient,
  type EnrolledProject,
  type ProjectRoleBinding,
  type SlackActionReceipt,
  type SlackFeatureThread,
  buildActionReceiptKey,
} from "../../domain/project-registry.js";
import {
  type RouteDecision,
  type SlackActionVerificationInput,
  type SlackInboundEnvelope,
  evaluateSlackAction,
  evaluateSlackRoute,
} from "../../domain/slack-routing.js";
import type {
  NotificationPayload,
  NotificationPort,
  NotificationReceipt,
} from "../../ports/notification-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";

export interface ProjectRoutingService {
  authorizeCommand(envelope: SlackInboundEnvelope): RouteDecision;
  authorizeAndClaimAction(
    input: Omit<
      SlackActionVerificationInput,
      "storedThread" | "priorReceipt"
    > & {
      nowIso: string;
    },
  ): RouteDecision;
  deliverProjectEvent(input: {
    projectId: string;
    featureId?: string;
    phaseId?: string;
    eventType: string;
    message: { text: string; blocks?: unknown[] };
    recipient?: DeliveryRecipient;
    opsOnly?: boolean;
    nowIso: string;
  }): Promise<NotificationReceipt>;
}

export interface ProjectRoutingDependencies {
  registry: ProjectRegistryPort;
  notificationPort?: NotificationPort;
  notifications?: NotificationPort;
}

export function createProjectRoutingService(
  deps: ProjectRoutingDependencies,
): ProjectRoutingService & { registry: ProjectRegistryPort } {
  const notifyPort = deps.notificationPort ?? deps.notifications;
  const threadLocks = new Map<string, Promise<unknown>>();

  async function withThreadLock<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = threadLocks.get(key) ?? Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    threadLocks.set(
      key,
      prev.then(() => current),
    );

    try {
      await prev;
      return await fn();
    } finally {
      resolveCurrent();
      if (threadLocks.get(key) === current) {
        threadLocks.delete(key);
      }
    }
  }

  return {
    registry: deps.registry,

    authorizeCommand(envelope: SlackInboundEnvelope): RouteDecision {
      const projects = deps.registry.listProjects();
      const roles = projects.flatMap((p) =>
        deps.registry.listRoleBindings(p.projectId),
      );
      return evaluateSlackRoute(projects, roles, envelope);
    },

    authorizeAndClaimAction(
      input: Omit<
        SlackActionVerificationInput,
        "storedThread" | "priorReceipt"
      > & {
        nowIso: string;
      },
    ): RouteDecision {
      const projects = deps.registry.listProjects();
      const roles = projects.flatMap((p) =>
        deps.registry.listRoleBindings(p.projectId),
      );

      const conversationCandidates = projects.filter(
        (p) =>
          p.slack?.workspaceId === input.workspaceId &&
          (input.isDirectMessage || p.slack.channelId === input.channelId),
      );

      let storedThread: SlackFeatureThread | null = null;
      const rootTs = input.threadTs ?? input.messageTs;

      if (input.payloadProjectId) {
        const thread = deps.registry.getFeatureThread(
          input.payloadProjectId,
          input.featureId,
        );
        if (thread) {
          storedThread = thread;
        }
      }

      if (!storedThread && rootTs) {
        for (const cand of conversationCandidates) {
          const thread = deps.registry.getFeatureThread(
            cand.projectId,
            input.featureId,
          );
          if (
            thread &&
            thread.workspaceId === input.workspaceId &&
            thread.channelId === input.channelId &&
            thread.rootTs === rootTs
          ) {
            storedThread = thread;
            break;
          }
        }
      }

      const candidateProjectId =
        input.payloadProjectId ??
        storedThread?.projectId ??
        (conversationCandidates.length === 1
          ? conversationCandidates[0].projectId
          : undefined);

      let priorReceipt: SlackActionReceipt | null = null;
      if (candidateProjectId) {
        const receiptKey = buildActionReceiptKey({
          projectId: candidateProjectId,
          actionId: input.actionId,
          featureId: input.featureId,
          phaseId: input.phaseId ?? null,
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          messageTs: input.messageTs ?? input.threadTs ?? "",
        });
        priorReceipt = deps.registry.getActionReceipt(receiptKey);
      }

      const decision = evaluateSlackAction(projects, roles, {
        ...input,
        storedThread,
        priorReceipt,
      });

      if (!decision.ok) {
        return decision;
      }

      const finalReceiptKey = buildActionReceiptKey({
        projectId: decision.project.projectId,
        actionId: input.actionId,
        featureId: input.featureId,
        phaseId: input.phaseId ?? null,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        messageTs: input.messageTs ?? input.threadTs ?? "",
      });

      const claimed = deps.registry.claimActionReceipt({
        receiptKey: finalReceiptKey,
        projectId: decision.project.projectId,
        actionId: input.actionId,
        featureId: input.featureId,
        phaseId: input.phaseId ?? null,
        messageTs: input.messageTs ?? input.threadTs ?? "",
        actorUserId: input.actorUserId,
        outcome: "claimed",
        recordedAt: input.nowIso,
      });

      if (!claimed) {
        return {
          ok: false,
          code: "ACTION_REPLAYED",
          message: "This action already has a receipt.",
        };
      }

      return decision;
    },

    async deliverProjectEvent(input: {
      projectId: string;
      featureId?: string;
      phaseId?: string;
      eventType: string;
      message: { text: string; blocks?: unknown[] };
      recipient?: DeliveryRecipient;
      opsOnly?: boolean;
      nowIso: string;
    }): Promise<NotificationReceipt> {
      const project = deps.registry.getProject(input.projectId);
      if (!project || !project.slack) {
        return { delivered: false };
      }

      if (input.opsOnly) {
        const channel = project.slack.opsChannelId ?? project.slack.channelId;
        const payload: NotificationPayload = {
          projectId: project.projectId,
          featureId: input.featureId,
          phaseId: input.phaseId,
          channel,
          text: input.message.text,
          blocks: input.message.blocks,
          opsOnly: true,
          recipient: input.recipient ?? {
            projectId: project.projectId,
            surface: "slack",
            workspaceId: project.slack.workspaceId,
            channelId: channel,
            opsOnly: true,
          },
        };
        if (!notifyPort) return { delivered: false };
        const result = await notifyPort.notify(payload);
        return (
          (result as NotificationReceipt) ?? {
            delivered: true,
            channelId: channel,
            messageTs: input.nowIso,
          }
        );
      }

      const channel = project.slack.channelId;
      if (!input.featureId) {
        const payload: NotificationPayload = {
          projectId: project.projectId,
          channel,
          text: input.message.text,
          blocks: input.message.blocks,
          recipient: input.recipient,
        };
        if (!notifyPort) return { delivered: false };
        const result = await notifyPort.notify(payload);
        return (
          (result as NotificationReceipt) ?? {
            delivered: true,
            channelId: channel,
            messageTs: input.nowIso,
          }
        );
      }

      const featureId = input.featureId;
      const slackConfig = project.slack;
      const lockKey = `${input.projectId}:${featureId}`;
      return withThreadLock(lockKey, async () => {
        const thread = deps.registry.getFeatureThread(
          input.projectId,
          featureId,
        );
        const payload: NotificationPayload = {
          projectId: project.projectId,
          featureId,
          phaseId: input.phaseId,
          channel: thread?.channelId ?? channel,
          threadTs: thread?.rootTs,
          text: input.message.text,
          blocks: input.message.blocks,
          recipient: input.recipient ?? {
            projectId: project.projectId,
            surface: "slack",
            workspaceId: slackConfig.workspaceId,
            channelId: thread?.channelId ?? channel,
            threadTs: thread?.rootTs,
          },
        };

        if (!notifyPort) return { delivered: false };
        const result = await notifyPort.notify(payload);
        const receipt: NotificationReceipt =
          (result as NotificationReceipt) ?? {
            delivered: true,
            channelId: payload.channel,
            messageTs: input.nowIso,
            threadTs: payload.threadTs,
          };

        if (receipt.delivered && !thread && receipt.messageTs) {
          deps.registry.bindFeatureThread({
            projectId: input.projectId,
            featureId,
            workspaceId: slackConfig.workspaceId,
            channelId: receipt.channelId ?? channel,
            rootTs: receipt.messageTs,
            updatedAt: input.nowIso,
          });
        }

        return receipt;
      });
    },
  };
}
