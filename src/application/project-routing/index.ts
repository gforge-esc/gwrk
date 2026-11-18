/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type DeliveryRecipient,
  type EnrolledProject,
  type ProjectRoleBinding,
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

type ActionInput = Omit<
  SlackActionVerificationInput,
  "storedThread" | "priorReceipt"
>;
type ActionClaimInput = ActionInput & { nowIso: string; retryFailed?: boolean };
type ActionClaimDecision =
  | (Extract<RouteDecision, { ok: true }> & { receiptKey?: string })
  | Extract<RouteDecision, { ok: false }>;

export interface ProjectRoutingService {
  authorizeCommand(envelope: SlackInboundEnvelope): RouteDecision;
  authorizeAction(input: ActionInput): RouteDecision;
  authorizeAndClaimAction(input: ActionClaimInput): ActionClaimDecision;
  getFeatureThread: ProjectRegistryPort["getFeatureThread"];
  completeActionReceipt: ProjectRegistryPort["completeActionReceipt"];
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
    const queued = prev.then(() => current);
    threadLocks.set(key, queued);

    try {
      await prev;
      return await fn();
    } finally {
      resolveCurrent();
      if (threadLocks.get(key) === queued) {
        threadLocks.delete(key);
      }
    }
  }

  function findActionThread(
    projects: EnrolledProject[],
    input: ActionInput,
  ): SlackFeatureThread | null {
    const rootTs = input.threadTs ?? input.messageTs;
    if (rootTs) {
      const conversationCandidates = projects.filter(
        (project) =>
          project.slack?.workspaceId === input.workspaceId &&
          (input.isDirectMessage ||
            project.slack.channelId === input.channelId),
      );

      for (const project of conversationCandidates) {
        const thread = deps.registry.getFeatureThread(
          project.projectId,
          input.featureId,
        );
        if (
          thread &&
          thread.workspaceId === input.workspaceId &&
          thread.channelId === input.channelId &&
          thread.rootTs === rootTs
        ) {
          return thread;
        }
      }
    }

    return input.payloadProjectId
      ? deps.registry.getFeatureThread(input.payloadProjectId, input.featureId)
      : null;
  }

  function authorizeAction(input: ActionInput): RouteDecision {
    const projects = deps.registry.listProjects();
    const roles = projects.flatMap((project) =>
      deps.registry.listRoleBindings(project.projectId),
    );
    return evaluateSlackAction(projects, roles, {
      ...input,
      storedThread: findActionThread(projects, input),
      priorReceipt: null,
    });
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

    authorizeAction,

    getFeatureThread: (projectId, featureId) =>
      deps.registry.getFeatureThread(projectId, featureId),

    completeActionReceipt: (receiptKey, outcome) =>
      deps.registry.completeActionReceipt(receiptKey, outcome),

    authorizeAndClaimAction(input: ActionClaimInput): ActionClaimDecision {
      const decision = authorizeAction(input);
      if (!decision.ok || input.requiredAccess === "read") return decision;

      const scope = {
        projectId: decision.project.projectId,
        actionId: input.actionId,
        featureId: input.featureId,
        phaseId: input.phaseId ?? null,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        messageTs: input.messageTs ?? input.threadTs ?? "",
      };
      let receiptKey = buildActionReceiptKey(scope);

      // Each failed attempt stays recorded. Concurrent retries contend for the same next key.
      let attempt = 0;
      while (
        input.retryFailed &&
        deps.registry.getActionReceipt(receiptKey)?.outcome === "failed"
      ) {
        attempt++;
        receiptKey = buildActionReceiptKey({
          ...scope,
          actionId: `${scope.actionId}:retry:${attempt}`,
        });
      }

      const claimed = deps.registry.claimActionReceipt({
        receiptKey,
        projectId: scope.projectId,
        actionId: scope.actionId,
        featureId: scope.featureId,
        phaseId: scope.phaseId,
        messageTs: scope.messageTs,
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

      return { ...decision, receiptKey };
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
        return result ?? { delivered: false };
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
        return result ?? { delivered: false };
      }

      const featureId = input.featureId;
      const slackConfig = project.slack;
      const lockKey = `${project.projectId}:${featureId}`;
      return withThreadLock(lockKey, async () => {
        const thread = deps.registry.getFeatureThread(
          project.projectId,
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
        const receipt: NotificationReceipt = result ?? { delivered: false };

        if (receipt.delivered && !thread && receipt.messageTs) {
          deps.registry.bindFeatureThread({
            projectId: project.projectId,
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
