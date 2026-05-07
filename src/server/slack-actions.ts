import { execSync } from "node:child_process";
import type { App } from "@slack/bolt";
import { findOpenPr } from "../db/runs.js";
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
): { pr_number: number; pr_url: string | null } {
  const pr = findOpenPr(featureId, phaseId);
  if (!pr) {
    // Try without phase filter as fallback
    const anyPr = findOpenPr(featureId);
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
  // Handle button actions
  app.action("merge_pr", async ({ ack, body, client, logger }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, phaseId } = JSON.parse(payload);

    try {
      const pr = lookupPr(featureId, phaseId);
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

    await client.chat.postMessage({
      channel: actionBody.channel?.id || "",
      text: `🔄 Changes requested for *${featureId}* phase *${phaseId}* by <@${actionBody.user.id}>. Agent notified.`,
    });

    // TODO: trigger a re-dispatch or update task status
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
      payloadPrNumber || findOpenPr(featureId, phaseId)?.pr_number;

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

              const pr = lookupPr(featureId, phaseId);
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
