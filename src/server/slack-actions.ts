/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync, spawn } from "node:child_process";
import type { App } from "@slack/bolt";
import { findOpenPr } from "../db/runs.js";
import { PlanStore } from "../engine/plan-store.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { CommandContext } from "./slack-commands.js";

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
  const pr = findOpenPr(featureId, phaseId, projectId);
  if (!pr) {
    // Try without phase filter as fallback
    const anyPr = findOpenPr(featureId, undefined, projectId);
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
  const projectId = resolveProjectId(context.projectRoot);

  // Handle button actions
  app.action("merge_pr", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, phaseId } = JSON.parse(payload);

    try {
      const pr = lookupPr(featureId, phaseId, projectId);
      mergeGitHubPr(pr.pr_number, context.projectRoot);

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `✅ PR #${pr.pr_number} for *${featureId}* phase *${phaseId}* merged by <@${actionBody.user.id}>`,
      });
    } catch (error) {
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

  app.action("request_changes", async ({ ack, body, client }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, phaseId } = JSON.parse(payload);

    try {
      context.queue.enqueue({ featureId, phaseId });

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `🔄 Changes requested for *${featureId}* phase *${phaseId}* by <@${actionBody.user.id}>. Agent notified and re-dispatching.`,
      });
    } catch (error) {
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
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, specPath } = JSON.parse(payload);

    try {
      // Approve spec triggers plan generation
      const child = spawn("gwrk", ["plan", featureId], {
        cwd: context.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `✅ Approved spec for *${featureId}* (${specPath}). Generating build plan...`,
      });
    } catch (error) {
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
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, planPath } = JSON.parse(payload);

    try {
      const store = new PlanStore(projectId);
      store.handleDefineComplete({ featureId, status: "DEFINED" });

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `✅ Approved plan for *${featureId}* (${planPath}). Feature status updated to *DEFINED*. Ready for implementation.`,
      });
    } catch (error) {
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
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId } = JSON.parse(payload);

    try {
      const child = spawn("gwrk", ["define", "spec", featureId], {
        cwd: context.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `🔄 Revision requested for *${featureId}* spec. Agent notified and re-generating spec...`,
      });
    } catch (error) {
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
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId } = JSON.parse(payload);

    try {
      const child = spawn("gwrk", ["define", "plan", featureId], {
        cwd: context.projectRoot,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `🔄 Revision requested for *${featureId}* plan. Agent notified and re-generating plan...`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await client.chat.postEphemeral({
        channel: actionBody.channel?.id || "",
        user: actionBody.user.id,
        text: `:warning: Failed to trigger plan revision: ${errorMessage}`,
      });
    }
  });

  app.action("view_review", async ({ ack, body, client }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const {
      featureId,
      phaseId,
      prNumber: payloadPrNumber,
    } = JSON.parse(payload);

    // Resolve PR URL: payload prNumber → runs table → gh pr list fallback
    let reviewUrl = "";
    const resolvedPrNumber =
      payloadPrNumber || findOpenPr(featureId, phaseId, projectId)?.pr_number;

    if (resolvedPrNumber) {
      try {
        reviewUrl = execSync(
          `gh pr view ${resolvedPrNumber} --json url -q .url`,
          { cwd: context.projectRoot, encoding: "utf-8", timeout: 10_000 },
        ).trim();
      } catch {
        // PR might not exist anymore
      }
    }

    if (!reviewUrl) {
      // Fallback: find any open PR for this feature branch
      try {
        reviewUrl = execSync(
          `gh pr list --head feat/${featureId} --json url -q '.[0].url'`,
          { cwd: context.projectRoot, encoding: "utf-8", timeout: 10_000 },
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

  app.action("retry_phase", async ({ ack, body, client }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, phaseId } = JSON.parse(payload);

    try {
      context.queue.enqueue({ featureId, phaseId });
      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `🔄 Retrying *${featureId}* phase *${phaseId}* as requested by <@${actionBody.user.id}>`,
      });
    } catch (error) {
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
              const { featureId, phaseId } = JSON.parse(actionValue);

              const pr = lookupPr(featureId, phaseId, projectId);
              mergeGitHubPr(pr.pr_number, context.projectRoot);
              await client.chat.postMessage({
                channel: event.item.channel,
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
