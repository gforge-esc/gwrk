/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import type { App } from "@slack/bolt";
import type { ActionsBlock } from "@slack/types";
import type { ProjectRoutingService } from "../application/project-routing/index.js";
import { findOpenPr } from "../db/runs.js";
import { requiredAccessForSlackAction } from "../domain/slack-routing.js";
import { PlanStore } from "../engine/plan-store.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  type CommandContext,
  buildSlackLogResponse,
} from "./slack-commands.js";

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
  threadTs?: string;
  receiptKey?: string;
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
  const decision: ReturnType<ProjectRoutingService["authorizeAndClaimAction"]> =
    requiredAccess === "read"
      ? context.routingService.authorizeAction(input)
      : context.routingService.authorizeAndClaimAction({
          ...input,
          nowIso: new Date().toISOString(),
          retryFailed,
        });

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

  const effectiveRoot =
    decision.project.localRoot ??
    decision.project.mirrorPath ??
    context.projectRoot;

  return {
    ok: true,
    projectRoot: effectiveRoot,
    projectId: decision.project.projectId,
    threadTs: decision.recipient.threadTs,
    receiptKey: decision.receiptKey,
  };
}

function completeReceipt(
  context: CommandContext,
  receiptKey?: string,
  outcome: "executed" | "failed" = "executed",
) {
  if (receiptKey) {
    context.routingService?.completeActionReceipt(receiptKey, outcome);
  }
}

/**
 * Look up the PR for a feature/phase from the runs table.
 * Returns { pr_number, pr_url } or throws with a user-friendly message.
 */
function lookupPr(
  featureId: string,
  phaseId: string,
  projectId: string,
): { pr_number: number; pr_url: string | null } {
  const pr = findOpenPr(featureId, projectId, phaseId);
  if (!pr) {
    // Try without phase filter as fallback
    const anyPr = findOpenPr(featureId, projectId, undefined);
    if (anyPr) {
      return anyPr;
    }
    throw new Error(
      `No open PR found for ${featureId} ${phaseId}. Has the ship loop created a PR?`,
    );
  }
  return pr;
}

export async function registerSlackActions(app: App, context: CommandContext) {
  const defaultProjectId = resolveProjectId(context.projectRoot);

  // Handle button actions
  app.action("merge_pr", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions?.[0]?.value;
    if (!payload) return;
    const payloadObj = parseActionPayload(payload);
    if (!payloadObj?.featureId) return;

    const { featureId, phaseId } = payloadObj;
    const auth = await verifyAndClaimClick(
      "merge_pr",
      actionBody,
      payloadObj,
      context,
      client,
      logger,
    );
    if (!auth.ok) return;

    try {
      if (!context.vcs)
        throw new Error("VCS port is required to merge pull requests.");
      const pr = lookupPr(featureId, phaseId ?? "", auth.projectId);
      await context.vcs.mergePullRequest(auth.projectRoot, pr.pr_number);
      completeReceipt(context, auth.receiptKey, "executed");

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `✅ PR #${pr.pr_number} for *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""} merged by <@${actionBody.user.id}>`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Merge failed: ${errorMessage}`);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to merge PR: ${errorMessage}`,
      });
    }
  });

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
      completeReceipt(context, auth.receiptKey, "executed");

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `🔄 Changes requested for *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""} by <@${actionBody.user.id}>. Agent notified and re-dispatching.`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to re-dispatch: ${errorMessage}`,
      });
    }
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
      const child = spawn("gwrk", ["plan", featureId], {
        cwd: auth.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      completeReceipt(context, auth.receiptKey, "executed");

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `✅ Approved spec for *${featureId}* (${specPath}). Generating build plan...`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to trigger planning: ${errorMessage}`,
      });
    }
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
      completeReceipt(context, auth.receiptKey, "executed");

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `✅ Approved plan for *${featureId}* (${planPath}). Feature status updated to *DEFINED*. Ready for implementation.`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to update plan status: ${errorMessage}`,
      });
    }
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
      const child = spawn("gwrk", ["define", "spec", featureId], {
        cwd: auth.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      completeReceipt(context, auth.receiptKey, "executed");

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `🔄 Revision requested for *${featureId}* spec. Agent notified and re-generating spec...`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to trigger spec revision: ${errorMessage}`,
      });
    }
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
      const child = spawn("gwrk", ["define", "plan", featureId], {
        cwd: auth.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      completeReceipt(context, auth.receiptKey, "executed");

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `🔄 Revision requested for *${featureId}* plan. Agent notified and re-generating plan...`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to trigger plan revision: ${errorMessage}`,
      });
    }
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
    if (context.vcs) {
      const prNumber =
        payloadPrNumber ??
        findOpenPr(featureId, auth.projectId, phaseId)?.pr_number;
      try {
        reviewUrl = await context.vcs.resolvePullRequestUrl(auth.projectRoot, {
          prNumber,
          headBranch: `feat/${featureId}`,
        });
      } catch (error) {
        logger.error(`Review lookup failed: ${String(error)}`);
      }
    }

    if (!reviewUrl) {
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: No open PR found for *${featureId}*. Has a ship run created one?`,
      });
      return;
    }

    await client.chat.postEphemeral({
      channel: actionBody.channel?.id || "",
      user: actionBody.user.id,
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
    const { blocks } = buildSlackLogResponse(args, auth.projectRoot);
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
      completeReceipt(context, auth.receiptKey, "executed");
      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        thread_ts: auth.threadTs,
        text: `🔄 Retrying *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""} as requested by <@${actionBody.user.id}>`,
      });
    } catch (error) {
      completeReceipt(context, auth.receiptKey, "failed");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to retry phase: ${errorMessage}`,
      });
    }
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

      let receiptKey: string | undefined;
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
        if (!payload?.featureId) return;

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
        const auth = await verifyAndClaimClick(
          "merge_pr",
          actionBody,
          payload,
          context,
          client,
          logger,
          !boltContext?.retryNum,
        );
        if (!auth.ok) return;
        receiptKey = auth.receiptKey;

        const { featureId, phaseId } = payload;
        const pr = lookupPr(featureId, phaseId ?? "", auth.projectId);
        await context.vcs.mergePullRequest(auth.projectRoot, pr.pr_number);
        const mergedReceiptKey = receiptKey;
        receiptKey = undefined;
        completeReceipt(context, mergedReceiptKey, "executed");

        await client.chat.postMessage({
          channel,
          thread_ts: auth.threadTs,
          text: `✅ Reaction-approval detected! Merged PR #${pr.pr_number} for *${featureId}*${phaseId ? ` phase *${phaseId}*` : ""}.`,
        });
      } catch (error) {
        completeReceipt(context, receiptKey, "failed");
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Reaction approval failed: ${errorMessage}`);
      }
    },
  );
}
