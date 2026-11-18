/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import type { App, BlockAction, ButtonAction } from "@slack/bolt";
import type { ActionsBlock } from "@slack/types";
import { scopedFeatureDirectory } from "../adapters/filesystem/scoped-feature.js";
import { verifyEnrolledCheckout } from "../adapters/git/project-id.js";
import type { ProjectRoutingService } from "../application/project-routing/index.js";
import { findOpenPr } from "../db/runs.js";
import { normalizeGitRemoteSlug } from "../domain/project-id.js";
import type {
  EnrolledProject,
  MergeTarget,
  SlackActionReceipt,
} from "../domain/project-registry.js";
import { requiredAccessForSlackAction } from "../domain/slack-routing.js";
import { PlanStore } from "../engine/plan-store.js";
import { MergePreflightError } from "../ports/vcs-port.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  type CommandContext,
  buildSlackLogResponse,
} from "./slack-commands.js";

async function launchDetachedGwrk(
  args: string[],
  projectRoot: string,
): Promise<void> {
  const child = spawn("gwrk", args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      child.removeListener("spawn", launched);
      reject(error);
    };
    const launched = () => {
      child.removeListener("error", failed);
      resolve();
    };
    child.once("error", failed);
    child.once("spawn", launched);
  });
  child.unref();
}

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

function resolveProjectCheckout(project: EnrolledProject): string | undefined {
  return (
    verifyEnrolledCheckout(project, "localRoot") ??
    verifyEnrolledCheckout(project, "mirrorPath")
  );
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
              const checkout = resolveProjectCheckout(project);
              if (
                !checkout ||
                !scopedFeatureDirectory(checkout, input.featureId, {
                  exactId: true,
                })
              ) {
                return undefined;
              }
              if (!usesStartupQueue) return checkout;
              try {
                return checkout === realpathSync(context.projectRoot)
                  ? checkout
                  : undefined;
              } catch {
                return undefined;
              }
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
        text: `:warning: Action unauthorized: ${decision.message}`,
      });
    }
    return { ok: false, projectRoot: context.projectRoot, projectId: "" };
  }

  const needsCheckout = actionId === "view_logs" || revisesCheckout;
  const checkoutRoot =
    actionId === "view_logs"
      ? resolveProjectCheckout(decision.project)
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

  app.action("request_changes", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId, phaseId } = payloadObj;
    const auth = await verifyAndClaimClick(
      "request_changes",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      context.queue.enqueue({ featureId, phaseId: phaseId ?? "" });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: Failed to re-dispatch: ${errorMessage}`,
      });
      return;
    }

    completeReceipt(context, auth.receiptKey, "executed");
    await postActionConfirmation(client, logger, "request_changes", {
      channel: actionBody.channel?.id || "",
      thread_ts: auth.threadTs,
      text: `🔄 Changes requested for *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""} by <@${actionBody.user.id}>. Agent notified and re-dispatching.`,
    });
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

  app.action("retry_phase", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId, phaseId } = payloadObj;
    const auth = await verifyAndClaimClick(
      "retry_phase",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      context.queue.enqueue({ featureId, phaseId: phaseId ?? "" });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        thread_ts: auth.threadTs,
        text: `:warning: Failed to retry phase: ${errorMessage}`,
      });
      return;
    }

    completeReceipt(context, auth.receiptKey, "executed");
    await postActionConfirmation(client, logger, "retry_phase", {
      channel: actionBody.channel?.id || "",
      thread_ts: auth.threadTs,
      text: `🔄 Retrying *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""} as requested by <@${actionBody.user.id}>`,
    });
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
