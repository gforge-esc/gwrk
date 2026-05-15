import type { App, SlackEventMiddlewareArgs } from "@slack/bolt";

/**
 * Handles @gwrk mentions with intelligent, conversational responses (Phase 2).
 */
export async function handleMention({
  event,
  say,
}: {
  event: SlackEventMiddlewareArgs<"app_mention">["event"];
  say: any;
}): Promise<void> {
  throw new Error("Not implemented: handleMention conversational surface");
}
