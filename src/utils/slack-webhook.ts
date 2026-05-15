/**
 * Sends a message via Slack Incoming Webhook (Phase 3).
 * Extracted for use in ship loop without build server.
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  payload: any
): Promise<void> {
  throw new Error("Not implemented: sendSlackWebhook");
}
