/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { normalizeGitRemoteSlug } from "../../domain/project-id.js";
import {
  type DeliveryRecipient,
  type EnrolledProject,
  type MergeTarget,
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
import type { PullRequestMergeOutcome, VcsPort } from "../../ports/vcs-port.js";

type ActionInput = Omit<
  SlackActionVerificationInput,
  "storedThread" | "priorReceipt"
>;
type ActionClaimInput = ActionInput & {
  nowIso: string;
  retryFailed?: boolean;
  requiredProjectId?: string | null;
  resolveCheckout?: (project: EnrolledProject) => string | undefined;
};
type ActionClaimDecision =
  | (Extract<RouteDecision, { ok: true }> & {
      receiptKey?: string;
      checkoutRoot?: string;
      mergeTarget?: MergeTarget;
    })
  | Extract<RouteDecision, { ok: false }>;

type MergeClaimInput = Omit<ActionInput, "actionId" | "requiredAccess"> & {
  nowIso: string;
  prNumber?: number;
  retryFailed: boolean;
  vcs?: VcsPort;
};

function actionReplay(): ActionClaimDecision {
  return {
    ok: false,
    code: "ACTION_REPLAYED",
    message: "This action already has a receipt.",
  };
}

function actionScope(projectId: string, input: ActionInput) {
  return {
    projectId,
    actionId: input.actionId,
    featureId: input.featureId,
    phaseId: input.phaseId ?? null,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    messageTs: input.messageTs ?? input.threadTs ?? "",
  };
}

function attemptKey(scope: ReturnType<typeof actionScope>, attempt: number) {
  return buildActionReceiptKey({
    ...scope,
    actionId: attempt ? `${scope.actionId}:retry:${attempt}` : scope.actionId,
  });
}

export interface ProjectRoutingService {
  authorizeCommand(envelope: SlackInboundEnvelope): RouteDecision;
  authorizeAction(input: ActionInput): RouteDecision;
  authorizeAndClaimAction(input: ActionClaimInput): ActionClaimDecision;
  authorizeAndClaimMerge(input: MergeClaimInput): Promise<ActionClaimDecision>;
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

  function claimAction(
    decision: Extract<RouteDecision, { ok: true }>,
    input: ActionInput & { nowIso: string },
    scope: ReturnType<typeof actionScope>,
    receiptKey: string,
    mergeTarget?: MergeTarget,
  ): ActionClaimDecision {
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
      mergeTarget,
    });
    return claimed ? { ...decision, receiptKey, mergeTarget } : actionReplay();
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

    completeActionReceipt: (receiptKey, outcome, expectedOutcome) =>
      deps.registry.completeActionReceipt(receiptKey, outcome, expectedOutcome),

    authorizeAndClaimAction(input: ActionClaimInput): ActionClaimDecision {
      const decision = authorizeAction(input);
      if (!decision.ok || input.requiredAccess === "read") return decision;
      if (
        input.requiredProjectId !== undefined &&
        decision.project.projectId !== input.requiredProjectId
      ) {
        return {
          ok: false,
          code: "REMOTE_AUTH_REQUIRED",
          message: "The dispatch queue is unavailable for this project.",
        };
      }

      const checkoutRoot = input.resolveCheckout?.(decision.project);
      if (input.resolveCheckout && !checkoutRoot) {
        return {
          ok: false,
          code: "REMOTE_AUTH_REQUIRED",
          message: "The project checkout is unavailable.",
        };
      }

      const scope = actionScope(decision.project.projectId, input);
      let receiptKey = attemptKey(scope, 0);

      // Each failed attempt stays recorded. Concurrent retries contend for the same next key.
      let attempt = 0;
      while (
        input.retryFailed &&
        deps.registry.getActionReceipt(receiptKey)?.outcome === "failed"
      ) {
        attempt++;
        receiptKey = attemptKey(scope, attempt);
      }

      const claim = claimAction(decision, input, scope, receiptKey);
      return claim.ok && checkoutRoot ? { ...claim, checkoutRoot } : claim;
    },

    async authorizeAndClaimMerge(input): Promise<ActionClaimDecision> {
      const action = {
        ...input,
        actionId: "merge_pr",
        requiredAccess: "maintain" as const,
      };
      const decision = authorizeAction(action);
      if (!decision.ok) return decision;

      const { project } = decision;
      const cwd = project.localRoot ?? project.mirrorPath;
      const slug = project.repoSlug && normalizeGitRemoteSlug(project.repoSlug);
      const repository =
        slug?.split("/").length === 2 ? `github.com/${slug}` : slug;
      if (!cwd || !repository || !input.vcs) {
        return {
          ok: false,
          code: "REMOTE_AUTH_REQUIRED",
          message: "Merging requires a verified checkout and VCS adapter.",
        };
      }

      const scope = actionScope(project.projectId, action);
      let attempt = 0;
      let receiptKey = attemptKey(scope, attempt);
      let receipt = deps.registry.getActionReceipt(receiptKey);
      if (receipt && !input.retryFailed) return actionReplay();

      let previousTarget: MergeTarget | undefined;
      while (receipt?.outcome === "failed") {
        previousTarget = receipt.mergeTarget ?? previousTarget;
        receiptKey = attemptKey(scope, ++attempt);
        receipt = deps.registry.getActionReceipt(receiptKey);
      }

      if (receipt?.outcome === "uncertain" || receipt?.outcome === "claimed") {
        const target = receipt.mergeTarget;
        if (
          target?.repository !== repository ||
          !input.vcs.inspectPullRequestMerge
        ) {
          return actionReplay();
        }
        let outcome: PullRequestMergeOutcome;
        try {
          outcome = await input.vcs.inspectPullRequestMerge(cwd, target);
        } catch {
          return actionReplay();
        }
        if (outcome === "merged") {
          deps.registry.completeActionReceipt(
            receiptKey,
            "executed",
            receipt.outcome,
          );
          return decision;
        }
        if (
          receipt.outcome === "claimed" ||
          outcome !== "rejected" ||
          !deps.registry.completeActionReceipt(
            receiptKey,
            "failed",
            "uncertain",
          )
        ) {
          return actionReplay();
        }
        // Reconciliation only grants a claim for the immediate next attempt.
        previousTarget = target;
        receiptKey = attemptKey(scope, ++attempt);
      } else if (receipt) {
        return actionReplay();
      }

      const { prNumber } = input;
      if (
        typeof prNumber !== "number" ||
        !Number.isSafeInteger(prNumber) ||
        prNumber <= 0
      ) {
        return {
          ok: false,
          code: "REMOTE_AUTH_REQUIRED",
          message: "This review card must specify a valid pull request number.",
        };
      }
      if (
        previousTarget &&
        (previousTarget.repository !== repository ||
          previousTarget.prNumber !== prNumber)
      ) {
        return actionReplay();
      }
      return claimAction(decision, action, scope, receiptKey, {
        repository,
        prNumber,
      });
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
        const channel = project.slack.opsChannelId;
        if (!channel) return { delivered: false };
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
      const lockKey = `${project.projectId}:${featureId}`;
      return withThreadLock(lockKey, async () => {
        const currentProject = deps.registry.getProject(project.projectId);
        if (!currentProject?.slack) return { delivered: false };
        const channel = currentProject.slack.channelId;
        const slackConfig = currentProject.slack;
        const storedThread = deps.registry.getFeatureThread(
          project.projectId,
          featureId,
        );
        const thread =
          storedThread?.workspaceId === slackConfig.workspaceId &&
          storedThread?.channelId === channel
            ? storedThread
            : undefined;
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

        if (
          receipt.delivered &&
          !thread &&
          receipt.messageTs &&
          /^\d+\.\d+$/.test(receipt.messageTs) &&
          receipt.channelId === channel &&
          (receipt.threadTs === undefined ||
            receipt.threadTs === receipt.messageTs)
        ) {
          deps.registry.bindFeatureThread({
            projectId: project.projectId,
            featureId,
            workspaceId: slackConfig.workspaceId,
            channelId: channel,
            rootTs: receipt.messageTs,
            updatedAt: input.nowIso,
          });
        }

        return receipt;
      });
    },
  };
}
