/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../../domain/project-registry.js";
import type {
  NotificationPort,
  NotificationReceipt,
} from "../../ports/notification-port.js";
import type {
  ClockPort,
  OperationsStorePort,
  OutboxDestination,
  OutboxItem,
} from "../../ports/operations-port.js";
import type { ProjectRegistryPort } from "../../ports/store-port.js";

interface ProjectNotification {
  project: EnrolledProject;
  dedupeKey: string;
  ownerKind: "dispatch" | "harvest";
  ownerOperationId: string;
  eventType: string;
  featureId: string;
  phaseId?: string;
  recipient: DeliveryRecipient;
  message: { text: string; blocks?: unknown[]; opsOnly?: boolean };
}
interface DeliveryOutcome {
  status: "delivered" | "uncertain" | "skipped_no_target" | "failed";
  messageTs?: string;
  threadTs?: string;
}
export interface OutboxDeliveryService {
  enqueueProjectNotification(input: ProjectNotification): string;
  flushOutboxItem(outboxId: string): Promise<DeliveryOutcome>;
  flushPendingForProject(projectId: string): Promise<number>;
}
interface Dependencies {
  store: OperationsStorePort;
  registry: Pick<ProjectRegistryPort, "getProject" | "getFeatureThread">;
  notifier: NotificationPort;
  clock: ClockPort;
  newId(): string;
}

function existingOutcome(item: OutboxItem | null): DeliveryOutcome {
  if (item?.status === "delivered")
    return {
      status: "delivered",
      messageTs: item.messageTs ?? undefined,
      threadTs: item.threadTs ?? undefined,
    };
  if (item?.status === "skipped_no_target")
    return { status: "skipped_no_target" };
  if (!item || item.status === "failed") return { status: "failed" };
  return { status: "uncertain" };
}
function matchesReceipt(
  receipt: unknown,
  route: OutboxDestination,
): receipt is NotificationReceipt & { channelId: string; messageTs: string } {
  return Boolean(
    receipt &&
      typeof receipt === "object" &&
      "delivered" in receipt &&
      receipt.delivered === true &&
      "channelId" in receipt &&
      "messageTs" in receipt &&
      receipt.channelId === route.channelId &&
      typeof receipt.messageTs === "string" &&
      receipt.messageTs.trim() &&
      ("threadTs" in receipt ? (receipt.threadTs ?? null) : null) ===
        route.threadTs,
  );
}

export function createOutboxDeliveryService(
  deps: Dependencies,
): OutboxDeliveryService {
  const { store, registry, notifier, clock } = deps;
  function destination(item: OutboxItem): OutboxDestination | null {
    if (item.status !== "pending") {
      return item.workspaceId && item.channelId
        ? {
            workspaceId: item.workspaceId,
            channelId: item.channelId,
            threadTs: item.threadTs,
          }
        : null;
    }
    if (
      item.recipient.surface !== "slack" ||
      item.recipient.projectId !== item.projectId
    )
      return null;
    const project = registry.getProject(item.projectId);
    if (project?.projectId !== item.projectId || !project.slack) return null;
    const { recipient } = item;
    const workspaceId = recipient.workspaceId ?? project.slack.workspaceId;
    const channelId =
      recipient.channelId ??
      (recipient.opsOnly || item.payload.opsOnly
        ? (project.slack.opsChannelId ?? project.slack.channelId)
        : project.slack.channelId);
    if (
      workspaceId !== project.slack.workspaceId ||
      (channelId !== project.slack.channelId &&
        channelId !== project.slack.opsChannelId)
    )
      return null;
    const thread = registry.getFeatureThread(item.projectId, item.featureId);
    const matchesThread =
      thread?.projectId === item.projectId &&
      thread.featureId === item.featureId &&
      thread.workspaceId === workspaceId &&
      thread.channelId === channelId;
    return {
      workspaceId,
      channelId,
      threadTs: recipient.threadTs ?? (matchesThread ? thread.rootTs : null),
    };
  }
  return {
    enqueueProjectNotification(input) {
      if (input.recipient.projectId !== input.project.projectId)
        throw new Error("Notification recipient belongs to another project");
      const item = store.enqueueOutbox({
        outboxId: deps.newId(),
        projectId: input.project.projectId,
        dedupeKey: input.dedupeKey,
        ownerKind: input.ownerKind,
        ownerOperationId: input.ownerOperationId,
        eventType: input.eventType,
        featureId: input.featureId,
        phaseId: input.phaseId ?? null,
        recipient: input.recipient,
        payload: input.message,
        clientMetadataKey: deps.newId(),
        nowIso: clock.nowIso(),
      });
      return item.outboxId;
    },
    async flushOutboxItem(outboxId) {
      const saved = store.getOutboxItem(outboxId);
      if (
        !saved ||
        ["delivered", "failed", "skipped_no_target"].includes(saved.status)
      )
        return existingOutcome(saved);
      const acquired = store.claimOutboxItem({
        outboxId,
        nowIso: clock.nowIso(),
        destination: destination(saved),
      });
      if (!acquired) return existingOutcome(store.getOutboxItem(outboxId));
      if (acquired.action === "skipped_no_target")
        return { status: "skipped_no_target" };
      const { claim, item } = acquired;
      const route: OutboxDestination = {
        workspaceId: item.workspaceId,
        channelId: item.channelId,
        threadTs: item.threadTs,
      };
      const uncertain = (error: string): DeliveryOutcome => {
        store.markOutboxUncertain({ claim, nowIso: clock.nowIso(), error });
        return { status: "uncertain" };
      };
      const complete = (receipt: unknown): DeliveryOutcome => {
        if (!matchesReceipt(receipt, route))
          return uncertain(
            "Delivery receipt does not match the accepted destination",
          );
        const result = store.completeOutboxItem({
          claim,
          nowIso: clock.nowIso(),
          outcome: {
            status: "delivered",
            channelId: receipt.channelId,
            messageTs: receipt.messageTs,
            threadTs: receipt.threadTs,
          },
        });
        return result.ok
          ? {
              status: "delivered",
              messageTs: receipt.messageTs,
              threadTs: receipt.threadTs,
            }
          : { status: "uncertain" };
      };
      try {
        if (acquired.action === "reconcile") {
          if (!notifier.reconcileDelivery)
            return uncertain("Delivery reconciliation is unavailable");
          const found = await notifier.reconcileDelivery({
            projectId: item.projectId,
            workspaceId: route.workspaceId,
            channelId: route.channelId,
            threadTs: route.threadTs ?? undefined,
            clientMetadataKey: item.clientMetadataKey,
          });
          if (found.status === "found") return complete(found.receipt);
          if (found.status !== "confirmed_absent")
            return uncertain(found.reason);
        }
        return complete(
          await notifier.notify({
            ...item.payload,
            projectId: item.projectId,
            featureId: item.featureId,
            phaseId: item.phaseId ?? undefined,
            clientMetadataKey: item.clientMetadataKey,
            channel: route.channelId,
            threadTs: route.threadTs ?? undefined,
            recipient: {
              ...item.recipient,
              surface: "slack",
              projectId: item.projectId,
              workspaceId: route.workspaceId,
              channelId: route.channelId,
              threadTs: route.threadTs ?? undefined,
            },
          }),
        );
      } catch (error) {
        return uncertain(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    async flushPendingForProject(projectId) {
      let completed = 0;
      for (const item of store.listRecoverableOutboxItems({
        projectId,
        nowIso: clock.nowIso(),
      })) {
        if (item.projectId !== projectId) continue;
        const result = await this.flushOutboxItem(item.outboxId);
        if (
          result.status === "delivered" ||
          result.status === "skipped_no_target"
        )
          completed++;
      }
      return completed;
    },
  };
}
