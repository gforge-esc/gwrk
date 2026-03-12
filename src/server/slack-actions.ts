import type { App } from "@slack/bolt";
import type { CommandContext } from "./slack-commands.js";

export async function registerSlackActions(app: App, context: CommandContext) {
  // Handle button actions
  app.action("merge_pr", async ({ ack, body, client, logger }) => {
    await ack();
    const payload = (body as any).actions[0].value;
    const { featureId, phaseId } = JSON.parse(payload);

    try {
      // Real PR merge logic using context.git
      context.git.mergePhaseBack(featureId, phaseId);

      await client.chat.postMessage({
        channel: (body as any).channel.id,
        text: `✅ PR for *${featureId}* phase *${phaseId}* merged by <@${(body as any).user.id}>`,
      });
    } catch (error: any) {
      logger.error(`Merge failed: ${error.message}`);
      await client.chat.postEphemeral({
        channel: (body as any).channel.id,
        user: (body as any).user.id,
        text: `:warning: Failed to merge PR: ${error.message}`,
      });
    }
  });

  app.action("request_changes", async ({ ack, body, client }) => {
    await ack();
    const payload = (body as any).actions[0].value;
    const { featureId, phaseId } = JSON.parse(payload);

    await client.chat.postMessage({
      channel: (body as any).channel.id,
      text: `🔄 Changes requested for *${featureId}* phase *${phaseId}* by <@${(body as any).user.id}>. Agent notified.`,
    });

    // In a real system, we'd trigger a re-dispatch or update task status
  });

  app.action("view_review", async ({ ack, body, client }) => {
    await ack();
    const payload = (body as any).actions[0].value;
    const { featureId, phaseId } = JSON.parse(payload);
    
    // Construct link to PR or review page
    const reviewUrl = `${context.buildServerUrl}/review/${featureId}/${phaseId}`;
    await client.chat.postEphemeral({
      channel: (body as any).channel.id,
      user: (body as any).user.id,
      text: `🔍 View full review here: <${reviewUrl}|${featureId} Review>`,
    });
  });

  app.action("retry_phase", async ({ ack, body, client }) => {
    await ack();
    const payload = (body as any).actions[0].value;
    const { featureId, phaseId } = JSON.parse(payload);

    try {
      context.queue.enqueue({ featureId, phaseId });
      await client.chat.postMessage({
        channel: (body as any).channel.id,
        text: `🔄 Retrying *${featureId}* phase *${phaseId}* as requested by <@${(body as any).user.id}>`,
      });
    } catch (error: any) {
      await client.chat.postEphemeral({
        channel: (body as any).channel.id,
        user: (body as any).user.id,
        text: `:warning: Failed to retry phase: ${error.message}`,
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
          message?.blocks?.some(
            (b: any) =>
              b.text?.text?.includes("Review Ready") ||
              b.header?.text?.includes("Review Ready"),
          )
        ) {
          // Find the feature/phase from the message blocks' action values
          const actionBlock = message.blocks?.find(
            (b: any) => b.type === "actions",
          );
          const actionValue = actionBlock?.elements?.[0]?.value;

          if (actionValue) {
            const { featureId, phaseId } = JSON.parse(actionValue);
            
            context.git.mergePhaseBack(featureId, phaseId);
            await client.chat.postMessage({
              channel: event.item.channel,
              text: `✅ Reaction-approval detected! Merged *${featureId}* phase *${phaseId}*.`,
            });
          }
        }
      } catch (error: any) {
        logger.error(`Reaction approval failed: ${error.message}`);
      }
    }
  });
}
