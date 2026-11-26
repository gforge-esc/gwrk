/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App, BlockAction, ButtonAction } from "@slack/bolt";
import type { ActionsBlock } from "@slack/types";
import { scopedFeatureDirectory } from "../adapters/filesystem/scoped-feature.js";
import type { ProjectRoutingService } from "../application/project-routing/index.js";
import { findOpenPr } from "../db/runs.js";
import type { DispatchReceipt } from "../domain/durable-dispatch.js";
import { normalizeGitRemoteSlug } from "../domain/project-id.js";
import {
  type DeliveryRecipient,
  type MergeTarget,
  type SlackActionReceipt,
  buildActionReceiptKey,
} from "../domain/project-registry.js";
import { requiredAccessForSlackAction } from "../domain/slack-routing.js";
import { PlanStore } from "../engine/plan-store.js";
import { MergePreflightError } from "../ports/vcs-port.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  type CommandContext,
  buildSlackLogResponse,
  resolveSlackCheckout,
} from "./slack-commands.js";
import { launchDetachedGwrk } from "./slack-launch.js";
import type { DispatchRecord } from "./types.js";

function parseActionPayload(rawPayload?: string): {
  featureId?: string;
  phaseId?: string;
  projectId?: string;
  projectSlug?: string;
  rootTs?: string;
  specPath?: string;
  planPath?: string;
  prNumber?: number;
  [key: string]: unknown;
} | null {
  if (!rawPayload) return null;
  try {
    return JSON.parse(rawPayload);
  } catch {
    return null;
  }
}

interface ActionVerificationResult {
  ok: boolean;
  projectRoot: string;
  projectId: string;
  projectRepository?: string;
  threadTs?: string;
  receiptKey?: string;
  mergeTarget?: MergeTarget;
}

async function verifyAndClaimClick(
  actionId: string,
  // biome-ignore lint/suspicious/noExplicitAny: Slack body structure
  actionBody: any,
  payloadObj: ReturnType<typeof parseActionPayload>,
  context: CommandContext,
  // biome-ignore lint/suspicious/noExplicitAny: Slack client
  client: any,
  // biome-ignore lint/suspicious/noExplicitAny: Logger
  logger: any,
  retryFailed = false,
): Promise<ActionVerificationResult> {
  if (!context.routingService) {
    logger?.error?.(
      `Action ${actionId} failed: no routing service available to authorize action`,
    );
    const channelId = actionBody.channel?.id ?? context.channelId ?? "";
    const actorUserId = actionBody.user?.id ?? context.userId ?? "";
    if (client?.chat?.postEphemeral && channelId && actorUserId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: actorUserId,
        text: ":warning: Action unauthorized: no routing service available",
      });
    }
    return { ok: false, projectRoot: context.projectRoot, projectId: "" };
  }

  const payloadProjectId = payloadObj?.projectId;
  const workspaceId =
    actionBody.team?.id ?? actionBody.team_id ?? context.workspaceId ?? "";
  const channelId = actionBody.channel?.id ?? context.channelId ?? "";
  const isDirectMessage = Boolean(channelId.startsWith("D"));
  const actorUserId = actionBody.user?.id ?? context.userId ?? "";
  const messageTs = actionBody.message?.ts;
  const threadTs = actionBody.message?.thread_ts;
  const requiredAccess = requiredAccessForSlackAction(actionId);
  const usesStartupQueue =
    actionId === "retry_phase" || actionId === "request_changes";
  const revisesCheckout =
    actionId === "revise_spec" ||
    actionId === "revise_plan" ||
    actionId === "approve_spec";

  const input = {
    workspaceId,
    channelId,
    isDirectMessage,
    actorUserId,
    threadTs,
    messageTs,
    actionId,
    payloadProjectId,
    featureId: payloadObj?.featureId || "",
    phaseId: payloadObj?.phaseId,
    payloadRootTs: payloadObj?.rootTs,
    requiredAccess,
  };
  const nowIso = new Date().toISOString();
  let decision: ReturnType<ProjectRoutingService["authorizeAndClaimAction"]>;
  if (actionId === "merge_pr") {
    decision = await context.routingService.authorizeAndClaimMerge({
      ...input,
      nowIso,
      prNumber: payloadObj?.prNumber,
      retryFailed,
      vcs: context.vcs,
    });
  } else if (requiredAccess === "read") {
    decision = context.routingService.authorizeAction(input);
  } else {
    decision = context.routingService.authorizeAndClaimAction({
      ...input,
      nowIso,
      resolveCheckout:
        usesStartupQueue || revisesCheckout
          ? (project) => {
              const checkout = resolveSlackCheckout(
                project,
                usesStartupQueue ? context.projectRoot : undefined,
              );
              if (
                !checkout ||
                !scopedFeatureDirectory(checkout, input.featureId, {
                  exactId: true,
                })
              ) {
                return undefined;
              }
              return checkout;
            }
          : undefined,
      requiredProjectId: usesStartupQueue
        ? (context.queueProjectId ?? null)
        : undefined,
    });
  }

  if (!decision.ok) {
    logger?.error?.(
      `Action ${actionId} unauthorized: ${decision.code} - ${decision.message}`,
    );
    if (client?.chat?.postEphemeral) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: actorUserId,
        ...(decision.recipient?.threadTs
          ? { thread_ts: decision.recipient.threadTs }
          : {}),
        text: `:warning: Action unauthorized: ${decision.message}`,
      });
    }
    return { ok: false, projectRoot: context.projectRoot, projectId: "" };
  }

  const needsCheckout = actionId === "view_logs" || revisesCheckout;
  const checkoutRoot =
    actionId === "view_logs"
      ? resolveSlackCheckout(decision.project)
      : decision.checkoutRoot;
  if (needsCheckout && !checkoutRoot) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: actorUserId,
      thread_ts: decision.recipient.threadTs,
      text: ":warning: The project checkout is unavailable.",
    });
    return { ok: false, projectRoot: context.projectRoot, projectId: "" };
  }

  const effectiveRoot =
    checkoutRoot ??
    decision.project.localRoot ??
    decision.project.mirrorPath ??
    context.projectRoot;

  return {
    ok: true,
    projectRoot: effectiveRoot,
    projectId: decision.project.projectId,
    projectRepository: decision.project.repoSlug
      ? (() => {
          const slug = normalizeGitRemoteSlug(decision.project.repoSlug);
          return slug?.split("/").length === 2
            ? `github.com/${slug}`
            : (slug ?? undefined);
        })()
      : undefined,
    threadTs: decision.recipient.threadTs,
    receiptKey: decision.receiptKey,
    mergeTarget: decision.mergeTarget,
  };
}

function completeReceipt(
  context: CommandContext,
  receiptKey?: string,
  outcome: Exclude<SlackActionReceipt["outcome"], "claimed"> = "executed",
) {
  if (receiptKey) {
    context.routingService?.completeActionReceipt(receiptKey, outcome);
  }
}

async function postActionConfirmation(
  client: App["client"],
  logger: { error(message: string): void },
  actionId: string,
  message: Parameters<App["client"]["chat"]["postMessage"]>[0],
) {
  try {
    await client.chat.postMessage(message);
  } catch (error) {
    logger.error(`Could not post ${actionId} confirmation: ${error}`);
  }
}

function lookupPr(
  featureId: string,
  projectId: string,
  phaseId: string | undefined,
  prNumber: number | undefined,
): number {
  if (
    typeof phaseId !== "string" ||
    !phaseId.trim() ||
    typeof prNumber !== "number" ||
    !Number.isInteger(prNumber) ||
    prNumber <= 0
  ) {
    throw new Error(
      "This review card must specify a phase and pull request number.",
    );
  }
  const pr = findOpenPr(featureId, projectId, phaseId);
  if (pr?.pr_number !== prNumber) {
    throw new Error(
      `PR #${prNumber} is no longer the open pull request for ${featureId} ${phaseId}.`,
    );
  }
  return prNumber;
}

type MergeActionBody = {
  team?: { id: string } | null;
  team_id?: string;
  channel?: { id: string };
  user: { id: string };
  message?: { ts: string; thread_ts?: string };
};

async function handleMerge(
  body: MergeActionBody,
  payload: ReturnType<typeof parseActionPayload>,
  context: CommandContext,
  client: App["client"],
  logger: { error(message: string): void },
  retryFailed: boolean,
) {
  if (!payload?.featureId) return;
  const auth = await verifyAndClaimClick(
    "merge_pr",
    body,
    payload,
    context,
    client,
    logger,
    retryFailed,
  );
  if (!auth.ok || !auth.receiptKey || !auth.mergeTarget || !context.vcs) return;

  const { featureId, phaseId } = payload;
  const { prNumber, repository } = auth.mergeTarget;
  const channel = body.channel?.id ?? context.channelId;
  const user = body.user.id;

  async function reportFailure(
    error: unknown,
    outcome: "failed" | "uncertain",
  ) {
    completeReceipt(context, auth.receiptKey, outcome);
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`Merge ${outcome}: ${detail}`);
    await client.chat.postEphemeral({
      channel,
      user,
      thread_ts: auth.threadTs,
      text:
        outcome === "uncertain"
          ? `:warning: Merge outcome unknown for PR #${prNumber}. ${detail}`
          : `:warning: Failed to merge PR: ${detail}`,
    });
  }

  try {
    lookupPr(featureId, auth.projectId, phaseId, prNumber);
  } catch (error) {
    await reportFailure(error, "failed");
    return;
  }

  try {
    await context.vcs.mergePullRequest(auth.projectRoot, prNumber, repository);
  } catch (error) {
    await reportFailure(
      error,
      error instanceof MergePreflightError ? "failed" : "uncertain",
    );
    return;
  }

  completeReceipt(context, auth.receiptKey, "executed");
  try {
    await client.chat.postMessage({
      channel,
      thread_ts: auth.threadTs,
      text: `✅ PR #${prNumber} for *${featureId}* phase *${phaseId}* merged by <@${user}>`,
    });
  } catch (error) {
    logger.error(`Could not post merge confirmation: ${error}`);
  }
}

export async function registerSlackActions(app: App, context: CommandContext) {
  const defaultProjectId = resolveProjectId(context.projectRoot);
  const activeMergeClicks = new Set<string>();
  const pendingAckDispatches = new Map<
    string,
    {
      actorUserId: string;
      threadTs?: string;
      receipt: DispatchReceipt;
      release: () => void;
    }
  >();

  // Handle button actions
  app.action<BlockAction<ButtonAction>>(
    "merge_pr",
    async ({ ack, body, context: boltContext, client, logger }) => {
      await ack();
      const payload = parseActionPayload(body.actions?.[0]?.value);
      const actionBody: MergeActionBody = body;
      const clickKey = JSON.stringify([
        actionBody.team?.id ?? actionBody.team_id ?? context.workspaceId,
        actionBody.channel?.id ?? context.channelId,
        actionBody.message?.ts ?? actionBody.message?.thread_ts,
        actionBody.user.id,
      ]);
      // A concurrent click from this actor must leave the active claim to its owner.
      const concurrent = activeMergeClicks.has(clickKey);
      if (!concurrent) activeMergeClicks.add(clickKey);
      try {
        await handleMerge(
          actionBody,
          payload,
          context,
          client,
          logger,
          !concurrent && !boltContext?.retryNum,
        );
      } finally {
        if (!concurrent) activeMergeClicks.delete(clickKey);
      }
    },
  );

  async function handleDurableDispatchAction(
    actionId: "request_changes" | "retry_phase",
    // biome-ignore lint/suspicious/noExplicitAny: Slack action handler args
    { ack, body, client, logger }: any,
  ) {
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) {
      await ack();
      return;
    }
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) {
      await ack();
      return;
    }

    const { featureId, phaseId } = payloadObj;
    const channelId = actionBody.channel?.id ?? context.channelId ?? "";
    const actorUserId = actionBody.user?.id ?? context.userId ?? "";

    const routingService = context.routingService;
    if (!routingService) {
      await ack();
      logger?.error?.(
        `Action ${actionId} failed: no routing service available to authorize action`,
      );
      if (client?.chat?.postEphemeral && channelId && actorUserId) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: actorUserId,
          text: ":warning: Action unauthorized: no routing service available",
        });
      }
      return;
    }

    const workspaceId =
      actionBody.team?.id ?? actionBody.team_id ?? context.workspaceId ?? "";
    const isDirectMessage = Boolean(channelId.startsWith("D"));
    const messageTs = actionBody.message?.ts;
    const threadTs = actionBody.message?.thread_ts;
    const requiredAccess = requiredAccessForSlackAction(actionId);
    const nowIso = new Date().toISOString();

    type DurableActionTxOutcome =
      | {
          ok: false;
          kind: "denied";
          decision: Extract<
            ReturnType<ProjectRoutingService["authorizeAndClaimAction"]>,
            { ok: false }
          >;
        }
      | {
          ok: false;
          kind: "legacy_enqueue_failed";
          threadTs?: string;
          errorMessage: string;
        }
      | {
          ok: true;
          threadTs?: string;
          receipt: DispatchReceipt | null;
          record?: DispatchRecord;
          receiptKey?: string;
          releaseDispatch?: () => void;
          isPendingAckReplay?: boolean;
        };

    const runTx = context.queue.runInTransaction
      ? <T>(fn: () => T) => context.queue.runInTransaction(fn)
      : <T>(fn: () => T) => fn();
    const hasMultiProjectQueue = typeof context.queue?.accept === "function";

    // Claim the authorized Slack action and persist DispatchReceipt in one
    // SQLite transaction strictly BEFORE calling Slack ack().
    const outcome = runTx((): DurableActionTxOutcome => {
      const decision = routingService.authorizeAndClaimAction({
        workspaceId,
        channelId,
        isDirectMessage,
        actorUserId,
        threadTs,
        messageTs,
        actionId,
        payloadProjectId: payloadObj.projectId,
        featureId,
        phaseId,
        payloadRootTs: payloadObj.rootTs,
        requiredAccess,
        nowIso,
        resolveCheckout: (project) => {
          const queueRoot =
            !hasMultiProjectQueue ||
            project.projectId === context.queueProjectId
              ? context.projectRoot
              : undefined;
          const checkout = resolveSlackCheckout(project, queueRoot);
          if (
            !checkout ||
            !scopedFeatureDirectory(checkout, featureId, { exactId: true })
          ) {
            return undefined;
          }
          return checkout;
        },
        requiredProjectId: hasMultiProjectQueue
          ? undefined
          : (context.queueProjectId ?? null),
      });

      if (!decision.ok) {
        if (
          decision.code === "ACTION_REPLAYED" &&
          decision.recipient?.projectId
        ) {
          const replayReceiptKey = buildActionReceiptKey({
            projectId: decision.recipient.projectId,
            actionId,
            featureId,
            phaseId: phaseId ?? null,
            workspaceId,
            channelId,
            messageTs: messageTs ?? threadTs ?? "",
          });
          const pending = pendingAckDispatches.get(replayReceiptKey);
          if (pending && pending.actorUserId === actorUserId) {
            return {
              ok: true,
              threadTs: pending.threadTs ?? decision.recipient.threadTs,
              receipt: pending.receipt,
              receiptKey: replayReceiptKey,
              releaseDispatch: pending.release,
              isPendingAckReplay: true,
            };
          }
        }
        return { ok: false, kind: "denied", decision };
      }

      const recipient: DeliveryRecipient = {
        projectId: decision.project.projectId,
        surface: "slack",
        workspaceId: decision.recipient.workspaceId ?? workspaceId,
        channelId: decision.recipient.channelId ?? channelId,
        ...(decision.recipient.threadTs
          ? { threadTs: decision.recipient.threadTs }
          : {}),
        actorUserId,
      };

      if (typeof context.queue.accept === "function") {
        let releaseDispatch: (() => void) | undefined;
        const receipt = context.queue.accept(
          {
            projectId: decision.project.projectId,
            featureId,
            phaseId: phaseId ?? "",
            recipient,
          },
          {
            deferDrain: (release) => {
              releaseDispatch = release;
            },
          },
        );
        if (receipt) {
          completeReceipt(context, decision.receiptKey, "executed");
          return {
            ok: true,
            threadTs: decision.recipient.threadTs,
            receipt,
            receiptKey: decision.receiptKey,
            releaseDispatch,
          };
        }
      }

      try {
        const record = context.queue.enqueue({
          featureId,
          phaseId: phaseId ?? "",
        });
        completeReceipt(context, decision.receiptKey, "executed");
        return {
          ok: true,
          threadTs: decision.recipient.threadTs,
          receipt: null,
          record,
        };
      } catch (error) {
        completeReceipt(context, decision.receiptKey, "failed");
        return {
          ok: false,
          kind: "legacy_enqueue_failed",
          threadTs: decision.recipient.threadTs,
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
    });

    if (
      outcome.ok &&
      !outcome.isPendingAckReplay &&
      outcome.receipt &&
      outcome.receiptKey &&
      outcome.releaseDispatch
    ) {
      pendingAckDispatches.set(outcome.receiptKey, {
        actorUserId,
        threadTs: outcome.threadTs,
        receipt: outcome.receipt,
        release: outcome.releaseDispatch,
      });
    }

    await ack();

    if (!outcome.ok) {
      if (outcome.kind === "denied") {
        logger?.error?.(
          `Action ${actionId} unauthorized: ${outcome.decision.code} - ${outcome.decision.message}`,
        );
        if (client?.chat?.postEphemeral) {
          await client.chat.postEphemeral({
            channel: channelId,
            user: actorUserId,
            ...(outcome.decision.recipient?.threadTs
              ? { thread_ts: outcome.decision.recipient.threadTs }
              : {}),
            text: `:warning: Action unauthorized: ${outcome.decision.message}`,
          });
        }
        return;
      }

      const failPrefix =
        actionId === "request_changes"
          ? "Failed to re-dispatch"
          : "Failed to retry phase";
      await client.chat.postEphemeral({
        channel: channelId,
        user: actorUserId,
        thread_ts: outcome.threadTs,
        text: `:warning: ${failPrefix}: ${outcome.errorMessage}`,
      });
      return;
    }

    if (outcome.receiptKey && outcome.releaseDispatch) {
      const pending = pendingAckDispatches.get(outcome.receiptKey);
      if (!pending) return;
      pendingAckDispatches.delete(outcome.receiptKey);
      pending.release();
    } else {
      outcome.releaseDispatch?.();
    }

    const operationId =
      outcome.receipt?.operationId ??
      outcome.record?.operationId ??
      outcome.record?.id;
    const attempt = outcome.receipt
      ? outcome.receipt.attemptCount > 0
        ? outcome.receipt.attemptCount
        : 1
      : 1;
    const phaseLabel = phaseId ? ` phase *${phaseId}*` : "";
    const receiptSuffix = operationId
      ? outcome.receipt?.deduplicated
        ? ` Active operation \`${operationId}\` (attempt ${attempt}).`
        : ` Operation \`${operationId}\` (attempt ${attempt}).`
      : actionId === "request_changes"
        ? " Agent notified and re-dispatching."
        : "";

    const text =
      actionId === "request_changes"
        ? `🔄 Changes requested for *${featureId}*${phaseLabel} by <@${actorUserId}>.${receiptSuffix}`
        : `🔄 Retrying *${featureId}*${phaseLabel} as requested by <@${actorUserId}>.${receiptSuffix}`;

    await postActionConfirmation(client, logger, actionId, {
      channel: channelId,
      thread_ts: outcome.threadTs,
      text,
    });
  }

  app.action("request_changes", async (args) => {
    await handleDurableDispatchAction("request_changes", args);
  });

  app.action("approve_spec", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId, specPath } = payloadObj;
    const auth = await verifyAndClaimClick(
      "approve_spec",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      // Approve spec triggers plan generation
      await launchDetachedGwrk(["define", "plan", featureId], auth.projectRoot);
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: Failed to trigger planning: ${errorMessage}`,
      });
      return;
    }

    completeReceipt(context, auth.receiptKey, "executed");
    await postActionConfirmation(client, logger, "approve_spec", {
      channel: actionBody.channel?.id || "",
      thread_ts: auth.threadTs,
      text: `✅ Approved spec for *${featureId}* (${specPath}). Generating build plan...`,
    });
  });

  app.action("approve_plan", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId, planPath } = payloadObj;
    const auth = await verifyAndClaimClick(
      "approve_plan",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      const store = new PlanStore(auth.projectId || defaultProjectId);
      store.handleDefineComplete({ featureId, status: "DEFINED" });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: Failed to update plan status: ${errorMessage}`,
      });
      return;
    }

    completeReceipt(context, auth.receiptKey, "executed");
    await postActionConfirmation(client, logger, "approve_plan", {
      channel: actionBody.channel?.id || "",
      thread_ts: auth.threadTs,
      text: `✅ Approved plan for *${featureId}* (${planPath}). Feature status updated to *DEFINED*. Ready for implementation.`,
    });
  });

  app.action("revise_spec", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId } = payloadObj;
    const auth = await verifyAndClaimClick(
      "revise_spec",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      await launchDetachedGwrk(["define", "spec", featureId], auth.projectRoot);
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: Failed to trigger spec revision: ${errorMessage}`,
      });
      return;
    }

    completeReceipt(context, auth.receiptKey, "executed");
    await postActionConfirmation(client, logger, "revise_spec", {
      channel: actionBody.channel?.id || "",
      thread_ts: auth.threadTs,
      text: `🔄 Revision requested for *${featureId}* spec. Agent notified and re-generating spec...`,
    });
  });

  app.action("revise_plan", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId } = payloadObj;
    const auth = await verifyAndClaimClick(
      "revise_plan",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      await launchDetachedGwrk(["define", "plan", featureId], auth.projectRoot);
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: Failed to trigger plan revision: ${errorMessage}`,
      });
      return;
    }

    completeReceipt(context, auth.receiptKey, "executed");
    await postActionConfirmation(client, logger, "revise_plan", {
      channel: actionBody.channel?.id || "",
      thread_ts: auth.threadTs,
      text: `🔄 Revision requested for *${featureId}* plan. Agent notified and re-generating plan...`,
    });
  });

  app.action("view_review", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId, phaseId, prNumber: payloadPrNumber } = payloadObj;
    const auth = await verifyAndClaimClick(
      "view_review",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    let reviewUrl: string | null = null;
    if (context.vcs && auth.projectRepository) {
      const prNumber =
        payloadPrNumber ??
        findOpenPr(featureId, auth.projectId, phaseId)?.pr_number;
      try {
        reviewUrl = await context.vcs.resolvePullRequestUrl(auth.projectRoot, {
          prNumber,
          headBranch: `feat/${featureId}`,
          expectedRepository: auth.projectRepository,
        });
      } catch (error) {
        logger.error(`Review lookup failed: ${String(error)}`);
      }
    }

    if (!reviewUrl) {
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: No open PR found for *${featureId}*. Has a ship run created one?`,
      });
      return;
    }

    await client.chat.postEphemeral({
      channel: actionBody.channel?.id || "",
      user: actionBody.user.id,
      thread_ts: auth.threadTs,
      text: `🔍 View full review here: <${reviewUrl}|${featureId} Review>`,
    });
  });

  app.action("view_logs", async ({ ack, body, client, logger }) => {
    await ack();
    if (body.type !== "block_actions") return;
    const button = body.actions[0];
    const payload = parseActionPayload(
      button?.type === "button" ? button.value : undefined,
    );
    if (!payload?.featureId) return;

    const auth = await verifyAndClaimClick(
      "view_logs",
      body,
      payload,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    const args = [payload.featureId];
    if (payload.phaseId) args.push(payload.phaseId);
    const { blocks } = buildSlackLogResponse(args, auth.projectRoot, {
      exactFeature: true,
    });
    await client.chat.postEphemeral({
      channel: body.channel?.id ?? context.channelId,
      user: body.user.id,
      thread_ts: auth.threadTs,
      text: `Run logs for ${payload.featureId}`,
      blocks,
    });
  });

  app.action("retry_phase", async (args) => {
    await handleDurableDispatchAction("retry_phase", args);
  });

  app.event(
    "reaction_added",
    async ({ event, body, context: boltContext, client, logger }) => {
      if (
        !context.routingService ||
        !context.vcs ||
        event.item.type !== "message" ||
        (event.reaction !== "white_check_mark" &&
          event.reaction !== "heavy_check_mark")
      ) {
        return;
      }

      try {
        const { channel, ts } = event.item;
        const { message } = await client.reactions.get({
          channel,
          timestamp: ts,
        });
        if (message?.ts !== ts) return;

        const actionBlock = message.blocks?.find(
          (block) => block.type === "actions",
        ) as ActionsBlock | undefined;
        const button = actionBlock?.elements.find(
          (element) =>
            element.type === "button" && element.action_id === "merge_pr",
        );
        const payload = parseActionPayload(
          button?.type === "button" ? button.value : undefined,
        );
        const threadTs =
          "thread_ts" in message && typeof message.thread_ts === "string"
            ? message.thread_ts
            : undefined;
        const actionBody = {
          team_id: body?.team_id ?? boltContext?.teamId ?? context.workspaceId,
          channel: { id: channel },
          user: { id: event.user },
          message: { ts, thread_ts: threadTs },
        };
        await handleMerge(
          actionBody,
          payload,
          context,
          client,
          logger,
          !boltContext?.retryNum,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Reaction approval failed: ${errorMessage}`);
      }
    },
  );
}
