/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync, spawn } from "node:child_process";
import type { App } from "@slack/bolt";
import { findOpenPr } from "../db/runs.js";
import { buildActionReceiptKey } from "../domain/project-registry.js";
import { requiredAccessForSlackAction } from "../domain/slack-routing.js";
import { PlanStore } from "../engine/plan-store.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { CommandContext } from "./slack-commands.js";

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
): Promise<ActionVerificationResult> {
  const payloadProjectId = payloadObj?.projectId;
  const isProjectScoped = Boolean(payloadProjectId || context.routingService);

  if (!isProjectScoped) {
    return {
      ok: true,
      projectRoot: context.projectRoot,
      projectId: resolveProjectId(context.projectRoot),
      threadTs: actionBody.message?.thread_ts,
    };
  }

  if (!context.routingService) {
    logger?.error?.(
      `Action ${actionId} failed: no routing service available to authorize project-scoped action`,
    );
    return { ok: false, projectRoot: context.projectRoot, projectId: "" };
  }

  const workspaceId =
    actionBody.team?.id ?? actionBody.team_id ?? context.workspaceId ?? "";
  const channelId = actionBody.channel?.id ?? context.channelId ?? "";
  const isDirectMessage = Boolean(channelId.startsWith("D"));
  const actorUserId = actionBody.user?.id ?? context.userId ?? "";
  const messageTs = actionBody.message?.ts;
  const threadTs = actionBody.message?.thread_ts;

  const decision = context.routingService.authorizeAndClaimAction({
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
    requiredAccess: requiredAccessForSlackAction(actionId),
    nowIso: new Date().toISOString(),
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

  const receiptKey = buildActionReceiptKey({
    projectId: decision.project.projectId,
    actionId,
    featureId: payloadObj?.featureId || "",
    phaseId: payloadObj?.phaseId ?? null,
    workspaceId,
    channelId,
    messageTs: messageTs ?? threadTs ?? "",
  });

  return {
    ok: true,
    projectRoot: effectiveRoot,
    projectId: decision.project.projectId,
    threadTs: decision.recipient.threadTs,
    receiptKey,
  };
}

function completeReceipt(
  context: CommandContext,
  receiptKey?: string,
  outcome: "executed" | "failed" = "executed",
) {
  if (receiptKey && context.routingService) {
    // biome-ignore lint/suspicious/noExplicitAny: Registry completeActionReceipt
    (context.routingService as any).registry?.completeActionReceipt(
      receiptKey,
      outcome,
    );
  }
}

/**
 * Merge a PR using the GitHub CLI.
 * Returns the merge output or throws on failure.
 */
function mergeGitHubPr(prNumber: number, cwd: string): string {
  return execSync(`gh pr merge ${prNumber} --merge --delete-branch`, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  }).trim();
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
      const pr = lookupPr(featureId, phaseId ?? "", auth.projectId);
      if (context.vcs) {
        await context.vcs.mergePullRequest(auth.projectRoot, pr.pr_number);
      } else {
        mergeGitHubPr(pr.pr_number, auth.projectRoot);
      }
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

    let reviewUrl = "";
    const prNumber =
      payloadPrNumber ||
      findOpenPr(featureId, auth.projectId, phaseId)?.pr_number;

    if (context.vcs) {
      try {
        const url = await context.vcs.resolvePullRequestUrl(auth.projectRoot, {
          prNumber: prNumber ? Number(prNumber) : undefined,
          headBranch: `feat/${featureId}`,
        });
        if (url) reviewUrl = url;
      } catch {
        // Fallback below
      }
    }

    if (!reviewUrl && prNumber) {
      try {
        reviewUrl = execSync(`gh pr view ${prNumber} --json url -q .url`, {
          cwd: auth.projectRoot,
          encoding: "utf-8",
          timeout: 10_000,
        }).trim();
      } catch {
        // PR might not exist anymore
      }
    }

    if (!reviewUrl) {
      // Fallback: find any open PR for this feature branch
      try {
        reviewUrl = execSync(
          `gh pr list --head feat/${featureId} --json url -q '.[0].url'`,
          { cwd: auth.projectRoot, encoding: "utf-8", timeout: 10_000 },
        ).trim();
      } catch {
        // No PR found
      }
    }

    if (!reviewUrl) {
      reviewUrl = `No PR found for ${featureId}`;
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

  // Handle reaction ✅
  app.event("reaction_added", async ({ event, client, logger }) => {
    if (
      event.reaction === "white_check_mark" ||
      event.reaction === "heavy_check_mark"
    ) {
      try {
        const result = await client.conversations.history({
          channel: event.item.channel,
          latest: event.item.ts,
          inclusive: true,
          limit: 1,
        });

        const message = result.messages?.[0];
        // Look for our structured markers in the text or blocks
        if (
          message?.text?.includes("Review Ready") ||
          message?.blocks?.some((b) => {
            // biome-ignore lint/suspicious/noExplicitAny: Slack block structure is complex
            const block = b as any;
            return (
              block.text?.text?.includes("Review Ready") ||
              block.header?.text?.includes("Review Ready")
            );
          })
        ) {
          // Find the feature/phase from the message blocks' action values
          const actionBlock = message.blocks?.find((b) => {
            // biome-ignore lint/suspicious/noExplicitAny: Slack block structure is complex
            return (b as any).type === "actions";
          });

          if (actionBlock) {
            // biome-ignore lint/suspicious/noExplicitAny: Slack block structure is complex
            const actionValue = (actionBlock as any).elements?.[0]?.value;

            if (actionValue) {
              const payloadObj = parseActionPayload(actionValue);
              if (!payloadObj?.featureId) return;
              const { featureId, phaseId } = payloadObj;

              const actionBody = {
                team: {
                  id: (event as { team?: string }).team || context.workspaceId,
                },
                channel: { id: event.item.channel },
                user: { id: event.user },
                message: {
                  ts: event.item.ts,
                  thread_ts: (message as { thread_ts?: string })?.thread_ts,
                },
                actions: [{ action_id: "merge_pr", value: actionValue }],
              };

              const auth = await verifyAndClaimClick(
                "merge_pr",
                actionBody,
                payloadObj,
                context,
                client,
                logger,
              );
              if (!auth.ok) return;

              const pr = lookupPr(featureId, phaseId ?? "", auth.projectId);
              if (context.vcs) {
                await context.vcs.mergePullRequest(
                  auth.projectRoot,
                  pr.pr_number,
                );
              } else {
                mergeGitHubPr(pr.pr_number, auth.projectRoot);
              }
              completeReceipt(context, auth.receiptKey, "executed");

              await client.chat.postMessage({
                channel: event.item.channel,
                thread_ts: auth.threadTs,
                text: `✅ Reaction-approval detected! Merged PR #${pr.pr_number} for *${featureId}* phase *${phaseId}*.`,
              });
            }
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Reaction approval failed: ${errorMessage}`);
      }
    }
  });
}
