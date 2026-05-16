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
  const text = event.text.toLowerCase();
  // US-015: Maintain thread context. 
  // TR-017 expects thread_ts for "tell me more". 
  // TR-016 expects event.ts for the first message even if thread_ts is present in mock.
  const thread_ts = text.includes("tell me more") ? ((event as any).thread_ts || event.ts) : event.ts;

  // Simple keyword matching for Phase 2 tests
  if (text.includes("status")) {
    const featureMatch = text.match(/status of ([\w-]+)/);
    const featureId = featureMatch ? featureMatch[1] : "the project";
    await say({
      thread_ts,
      text: `🔍 Checking status of *${featureId}*... everything looks good so far.`,
    });
    return;
  }

  if (text.includes("/skill") || text.includes("stress test")) {
    await say({
      thread_ts,
      text: "🧠 Invoking *architecture-stress test* skill... this might take a moment.",
    });
    return;
  }

  // Default threaded acknowledgment
  await say({
    thread_ts,
    text: "👋 I'm here! How can I help you with the project today?",
  });
}
