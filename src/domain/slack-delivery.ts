/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  DeliveryRecipient,
  EnrolledProject,
  SlackFeatureThread,
} from "./project-registry.js";

export type SlackDeliveryRejectionCode =
  | "NON_SLACK_SURFACE"
  | "CONFLICTING_PROJECT_ID"
  | "CONFLICTING_WORKSPACE_ID"
  | "CONFLICTING_CHANNEL_ID"
  | "CONFLICTING_THREAD_TS"
  | "MISSING_OPS_CHANNEL"
  | "MISSING_CHANNEL";

export interface SlackDeliveryContextInput {
  projectId?: string;
  eventProjectId?: string;
  recipient?: DeliveryRecipient;
  eventRecipient?: DeliveryRecipient;
  channelId?: string;
  threadTs?: string;
  opsOnly?: boolean;
  eventOpsOnly?: boolean;
}

export interface ValidatedSlackDeliveryContext {
  projectId?: string;
  recipient?: DeliveryRecipient;
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
  opsOnly: boolean;
}

export type SlackDeliveryContextResult =
  | { ok: true; context: ValidatedSlackDeliveryContext }
  | { ok: false; code: SlackDeliveryRejectionCode };

export interface ResolveSlackDeliveryRouteInput
  extends SlackDeliveryContextInput {
  project?: EnrolledProject | null;
  storedThread?: SlackFeatureThread | null;
  fallbackChannelId?: string;
  fallbackOpsChannelId?: string;
  requireChannel?: boolean;
}

export interface ResolvedSlackRoute {
  projectId?: string;
  expectedWorkspaceId?: string;
  channelId?: string;
  threadTs?: string;
  opsOnly: boolean;
  recipient?: DeliveryRecipient;
}

export type SlackDeliveryRouteResult =
  | { ok: true; route: ResolvedSlackRoute }
  | { ok: false; code: SlackDeliveryRejectionCode };

export interface QueuedAwayItem<TEvent, TMessage> {
  event: TEvent;
  message: TMessage;
  recipient?: DeliveryRecipient;
  channelId?: string;
  threadTs?: string;
  opsOnly: boolean;
}

export interface AwayBatchPartition<TEvent, TMessage> {
  opsOnly: boolean;
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
  recipient?: DeliveryRecipient;
  items: QueuedAwayItem<TEvent, TMessage>[];
}

function agreeValues(
  values: ReadonlyArray<string | undefined>,
): { ok: true; value: string | undefined } | { ok: false } {
  let agreed: string | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    if (agreed === undefined) {
      agreed = value;
    } else if (agreed !== value) {
      return { ok: false };
    }
  }
  return { ok: true, value: agreed };
}

export function validateSlackDeliveryContext(
  input: SlackDeliveryContextInput,
): SlackDeliveryContextResult {
  if (input.recipient && input.recipient.surface !== "slack") {
    return { ok: false, code: "NON_SLACK_SURFACE" };
  }
  if (input.eventRecipient && input.eventRecipient.surface !== "slack") {
    return { ok: false, code: "NON_SLACK_SURFACE" };
  }

  const projectId = agreeValues([
    input.projectId,
    input.eventProjectId,
    input.recipient?.projectId,
    input.eventRecipient?.projectId,
  ]);
  if (!projectId.ok) {
    return { ok: false, code: "CONFLICTING_PROJECT_ID" };
  }

  const workspaceId = agreeValues([
    input.recipient?.workspaceId,
    input.eventRecipient?.workspaceId,
  ]);
  if (!workspaceId.ok) {
    return { ok: false, code: "CONFLICTING_WORKSPACE_ID" };
  }

  const channelId = agreeValues([
    input.channelId,
    input.recipient?.channelId,
    input.eventRecipient?.channelId,
  ]);
  if (!channelId.ok) {
    return { ok: false, code: "CONFLICTING_CHANNEL_ID" };
  }

  const threadTs = agreeValues([
    input.threadTs,
    input.recipient?.threadTs,
    input.eventRecipient?.threadTs,
  ]);
  if (!threadTs.ok) {
    return { ok: false, code: "CONFLICTING_THREAD_TS" };
  }

  const opsOnly = Boolean(
    input.opsOnly ||
      input.eventOpsOnly ||
      input.recipient?.opsOnly ||
      input.eventRecipient?.opsOnly,
  );

  const resolvedThreadTs = opsOnly ? undefined : threadTs.value;
  const baseRecipient = input.recipient ?? input.eventRecipient;
  const recipient: DeliveryRecipient | undefined = baseRecipient
    ? {
        ...baseRecipient,
        projectId: projectId.value ?? baseRecipient.projectId,
        surface: "slack",
        workspaceId: workspaceId.value,
        channelId: channelId.value,
        threadTs: resolvedThreadTs,
        actorUserId:
          input.recipient?.actorUserId ?? input.eventRecipient?.actorUserId,
        opsOnly: opsOnly ? true : undefined,
      }
    : undefined;

  return {
    ok: true,
    context: {
      projectId: projectId.value,
      recipient,
      workspaceId: workspaceId.value,
      channelId: channelId.value,
      threadTs: resolvedThreadTs,
      opsOnly,
    },
  };
}

export interface ResolveProjectSlackRecipientInput {
  project: EnrolledProject;
  enrolledProjects?: readonly EnrolledProject[];
  storedThread?: SlackFeatureThread | null;
  recipient?: DeliveryRecipient;
  opsOnly?: boolean;
}

export type ProjectSlackRecipientRejectionReason =
  | "WORKSPACE_MISMATCH"
  | "CHANNEL_MISMATCH"
  | "THREAD_MISMATCH";

export type ProjectSlackRecipientResult =
  | {
      ok: true;
      recipient?: DeliveryRecipient;
      validStoredThread?: SlackFeatureThread;
    }
  | {
      ok: false;
      reason: ProjectSlackRecipientRejectionReason;
      message: string;
    };

export function isSharedSlackChannel(
  project: EnrolledProject,
  enrolledProjects?: readonly EnrolledProject[],
): boolean {
  const slack = project.slack;
  if (!slack) return false;
  if (slack.sharedChannel) return true;
  if (!enrolledProjects) return false;
  return enrolledProjects.some(
    (candidate) =>
      candidate.projectId !== project.projectId &&
      candidate.slack?.workspaceId === slack.workspaceId &&
      candidate.slack?.channelId === slack.channelId,
  );
}

export function resolveProjectSlackRecipient(
  input: ResolveProjectSlackRecipientInput,
): ProjectSlackRecipientResult {
  const { project, enrolledProjects, storedThread, recipient } = input;
  const slackBinding = project.slack ?? undefined;
  const isOps = Boolean(input.opsOnly || recipient?.opsOnly);
  const validStoredThread =
    !isOps &&
    storedThread &&
    slackBinding &&
    storedThread.projectId === project.projectId &&
    storedThread.workspaceId === slackBinding.workspaceId &&
    storedThread.channelId === slackBinding.channelId
      ? storedThread
      : undefined;

  if (recipient) {
    if (
      recipient.workspaceId &&
      (!slackBinding?.workspaceId ||
        recipient.workspaceId !== slackBinding.workspaceId)
    ) {
      return {
        ok: false,
        reason: "WORKSPACE_MISMATCH",
        message: "Recipient workspace does not match authorized project.",
      };
    }

    if (recipient.channelId) {
      const expectedChannelId = isOps
        ? slackBinding?.opsChannelId
        : slackBinding?.channelId;
      if (!expectedChannelId || recipient.channelId !== expectedChannelId) {
        return {
          ok: false,
          reason: "CHANNEL_MISMATCH",
          message: "Recipient channel does not match authorized project.",
        };
      }
    }

    if (!isOps && recipient.threadTs !== undefined) {
      if (!slackBinding || !recipient.threadTs.trim()) {
        return {
          ok: false,
          reason: "THREAD_MISMATCH",
          message: "Recipient thread does not match authorized project.",
        };
      }
      if (validStoredThread) {
        if (recipient.threadTs !== validStoredThread.rootTs) {
          return {
            ok: false,
            reason: "THREAD_MISMATCH",
            message: "Recipient thread does not match stored feature thread.",
          };
        }
      } else if (isSharedSlackChannel(project, enrolledProjects)) {
        return {
          ok: false,
          reason: "THREAD_MISMATCH",
          message:
            "Unverified thread hint is not allowed in a shared Slack channel.",
        };
      }
    }
  }

  if (recipient?.surface === "slack") {
    const workspaceId = recipient.workspaceId ?? slackBinding?.workspaceId;
    const channelId =
      recipient.channelId ??
      (isOps ? slackBinding?.opsChannelId : slackBinding?.channelId);
    const threadTs = isOps
      ? undefined
      : (validStoredThread?.rootTs ?? recipient.threadTs);
    const {
      threadTs: _ignoredThreadTs,
      opsOnly: _ignoredOpsOnly,
      ...rest
    } = recipient;

    return {
      ok: true,
      validStoredThread,
      recipient: {
        ...rest,
        projectId: project.projectId,
        surface: "slack",
        ...(workspaceId ? { workspaceId } : {}),
        ...(channelId ? { channelId } : {}),
        ...(threadTs ? { threadTs } : {}),
        ...(isOps ? { opsOnly: true } : {}),
      },
    };
  }

  if (slackBinding) {
    const channelId = isOps
      ? slackBinding.opsChannelId
      : slackBinding.channelId;
    const threadTs = isOps ? undefined : validStoredThread?.rootTs;
    return {
      ok: true,
      validStoredThread,
      recipient: {
        projectId: project.projectId,
        surface: "slack",
        workspaceId: slackBinding.workspaceId,
        ...(channelId ? { channelId } : {}),
        ...(threadTs ? { threadTs } : {}),
        ...(isOps ? { opsOnly: true } : {}),
      },
    };
  }

  return {
    ok: true,
    validStoredThread,
    recipient: undefined,
  };
}

export function resolveSlackDeliveryRoute(
  input: ResolveSlackDeliveryRouteInput,
): SlackDeliveryRouteResult {
  const validated = validateSlackDeliveryContext(input);
  if (!validated.ok) {
    return validated;
  }

  const ctx = validated.context;
  const slackBinding = input.project?.slack ?? undefined;

  if (
    slackBinding?.workspaceId &&
    ctx.workspaceId &&
    slackBinding.workspaceId !== ctx.workspaceId
  ) {
    return { ok: false, code: "CONFLICTING_WORKSPACE_ID" };
  }

  const expectedWorkspaceId = slackBinding?.workspaceId ?? ctx.workspaceId;

  let channelId: string | undefined;
  let threadTs: string | undefined;

  if (ctx.opsOnly) {
    threadTs = undefined;
    if (input.project) {
      if (!slackBinding?.opsChannelId) {
        return { ok: false, code: "MISSING_OPS_CHANNEL" };
      }
      channelId = slackBinding.opsChannelId;
    } else if (ctx.projectId) {
      channelId = ctx.channelId;
      if (!channelId) {
        return { ok: false, code: "MISSING_OPS_CHANNEL" };
      }
    } else {
      channelId = ctx.channelId ?? input.fallbackOpsChannelId;
      if (!channelId) {
        return { ok: false, code: "MISSING_OPS_CHANNEL" };
      }
    }
  } else {
    const validStoredThread =
      input.storedThread &&
      slackBinding &&
      input.storedThread.workspaceId === slackBinding.workspaceId &&
      input.storedThread.channelId === slackBinding.channelId &&
      (!ctx.channelId || ctx.channelId === input.storedThread.channelId)
        ? input.storedThread
        : undefined;

    channelId = ctx.projectId
      ? (ctx.channelId ??
        validStoredThread?.channelId ??
        slackBinding?.channelId)
      : (ctx.channelId ?? input.fallbackChannelId);

    threadTs = ctx.threadTs ?? validStoredThread?.rootTs;

    if (input.requireChannel && !channelId) {
      return { ok: false, code: "MISSING_CHANNEL" };
    }
  }

  const recipient: DeliveryRecipient | undefined = ctx.recipient
    ? {
        ...ctx.recipient,
        projectId: ctx.projectId ?? ctx.recipient.projectId,
        surface: "slack",
        workspaceId: expectedWorkspaceId ?? ctx.recipient.workspaceId,
        channelId: channelId ?? ctx.recipient.channelId,
        threadTs: ctx.opsOnly ? undefined : threadTs,
        opsOnly: ctx.opsOnly ? true : undefined,
      }
    : undefined;

  return {
    ok: true,
    route: {
      projectId: ctx.projectId,
      expectedWorkspaceId,
      channelId,
      threadTs: ctx.opsOnly ? undefined : threadTs,
      opsOnly: ctx.opsOnly,
      recipient,
    },
  };
}

export function resolveAwayQueueTarget(input: {
  projectId?: string;
  eventProjectId?: string;
  recipient?: DeliveryRecipient;
  recipientUserId?: string;
  eventRecipientUserId?: string;
  legacyUserId?: string | null;
}): {
  isScoped: boolean;
  projectId: string;
  recipientUserId?: string;
} {
  const explicitProjectId =
    input.eventProjectId ?? input.projectId ?? input.recipient?.projectId;
  const isScoped = Boolean(
    input.recipient || (explicitProjectId && explicitProjectId !== "default"),
  );
  const projectId = explicitProjectId ?? "default";
  const explicitUserId =
    input.eventRecipientUserId ??
    input.recipientUserId ??
    input.recipient?.actorUserId;
  const recipientUserId = isScoped
    ? explicitUserId
    : (explicitUserId ?? input.legacyUserId ?? undefined);

  return { isScoped, projectId, recipientUserId };
}

export function partitionAwayBatch<TEvent, TMessage>(
  items: readonly QueuedAwayItem<TEvent, TMessage>[],
): AwayBatchPartition<TEvent, TMessage>[] {
  const groups = new Map<
    string,
    {
      opsOnly: boolean;
      workspaceId?: string;
      channelId?: string;
      items: QueuedAwayItem<TEvent, TMessage>[];
    }
  >();

  for (const item of items) {
    const channelId = item.channelId ?? item.recipient?.channelId;
    const workspaceId = item.recipient?.workspaceId;
    const key = `${item.opsOnly ? "ops" : "feature"}:${workspaceId ?? ""}:${channelId ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        opsOnly: item.opsOnly,
        workspaceId,
        channelId,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  const partitions: AwayBatchPartition<TEvent, TMessage>[] = [];
  for (const group of groups.values()) {
    let threadTs: string | undefined;
    if (!group.opsOnly) {
      const threads = new Set(
        group.items
          .map((item) => item.threadTs ?? item.recipient?.threadTs)
          .filter((ts): ts is string => Boolean(ts)),
      );
      if (
        threads.size === 1 &&
        group.items.every((item) =>
          Boolean(item.threadTs ?? item.recipient?.threadTs),
        )
      ) {
        threadTs = [...threads][0];
      }
    }

    const baseRecipient = group.items.find((item) => item.recipient)?.recipient;
    const recipient: DeliveryRecipient | undefined = baseRecipient
      ? {
          ...baseRecipient,
          workspaceId: group.workspaceId ?? baseRecipient.workspaceId,
          channelId: group.channelId ?? baseRecipient.channelId,
          threadTs: group.opsOnly ? undefined : threadTs,
          opsOnly: group.opsOnly ? true : undefined,
        }
      : undefined;

    partitions.push({
      opsOnly: group.opsOnly,
      workspaceId: group.workspaceId,
      channelId: group.channelId,
      threadTs: group.opsOnly ? undefined : threadTs,
      recipient,
      items: group.items,
    });
  }

  return partitions;
}
