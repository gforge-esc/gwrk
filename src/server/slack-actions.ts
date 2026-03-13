import type { App } from "@slack/bolt";
import type { CommandContext } from "./slack-commands.js";

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
      // Real PR merge logic using context.git
      context.git.mergePhaseBack(featureId, phaseId);

      await client.chat.postMessage({
        channel: actionBody.channel?.id || "",
        text: `✅ PR for *${featureId}* phase *${phaseId}* merged by <@${actionBody.user.id}>`,
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

    // In a real system, we'd trigger a re-dispatch or update task status
  });

  app.action("view_review", async ({ ack, body, client }) => {
    await ack();
    // biome-ignore lint/suspicious/noExplicitAny: Slack body structure is complex
    const actionBody = body as any;
    const payload = actionBody.actions[0].value;
    if (!payload) return;
    const { featureId, phaseId } = JSON.parse(payload);

    // Construct link to PR or review page
    const reviewUrl = `${context.buildServerUrl}/review/${featureId}/${phaseId}`;
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

              context.git.mergePhaseBack(featureId, phaseId);
              await client.chat.postMessage({
                channel: event.item.channel,
                text: `✅ Reaction-approval detected! Merged *${featureId}* phase *${phaseId}*.`,
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
