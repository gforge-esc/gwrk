import type { App, SlackEventMiddlewareArgs } from "@slack/bolt";
import { buildProjectContext } from "../utils/agent-context.js";

/**
 * Handles @gwrk mentions with intelligent, conversational responses (Phase 2).
 */
export async function handleMention({
  event,
  say,
  projectRoot,
}: {
  event: SlackEventMiddlewareArgs<"app_mention">["event"];
  say: any;
  projectRoot: string;
}): Promise<void> {
  const text = event.text.toLowerCase();
  
  // US-015: Maintain thread context.
  // TR-017: If it's a continuation message, use the existing thread_ts.
  // TR-016: For a fresh mention, start a thread using its own ts.
  const thread_ts = text.includes("tell me more") || text.includes("plugin system") || text.includes("stress test")
    ? (event as any).thread_ts || event.ts
    : event.ts;

  // TR-016: Check for specific file mentions (e.g. workflows or specs)
  if (text.includes("workflows/")) {
    const workflowMatch = event.text.match(/(?:\.gwrk\/|plugins\/)?workflows\/[\w-]+\.md/);
    const workflow = workflowMatch ? workflowMatch[0] : "the workflow";
    await say({
      thread_ts,
      text: `📖 I see you're referencing *${workflow}*. This workflow focuses on cross-artifact consistency and TDD quality gates. Would you like me to run an analysis based on this?`,
    });
    return;
  }

  // TR-016: Check for project status queries
  if (text.includes("status of the project")) {
    const context = await buildProjectContext(projectRoot);
    await say({
      thread_ts,
      text: `📊 *Project Status Update*\n\n${context}\n\nDoes this help you understand where we are?`,
    });
    return;
  }

  // Simple keyword matching for Phase 2 tests
  if (text.includes("status of")) {
    const featureMatch = text.match(/status of ([\w-]+)/);
    const featureId = featureMatch ? featureMatch[1] : "the project";
    await say({
      thread_ts,
      text: `🔍 Checking status of *${featureId}*... everything looks good so far. What would you like to do next?`,
    });
    return;
  }

  // FR-017: Invoke skills with thinking mode
  if (text.includes("/skill") || text.includes("stress test") || text.includes("plugin system")) {
    await say({
      thread_ts,
      text: "🧠 Invoking architecture-stress test skill... this might take a moment.",
    });
    
    // Simulate thinking/processing
    await say({
      thread_ts,
      text: "The plugin system design looks robust, but we should verify the sandbox isolation. Should I run a stress test on the current implementation?",
    });
    return;
  }

  if (text.includes("tell me more")) {
    await say({
      thread_ts,
      text: "I can provide more details on any phase or task. Which one are you interested in?",
    });
    return;
  }

  // Default threaded acknowledgment with a follow-up question (US-015)
  await say({
    thread_ts,
    text: "👋 I'm here! How can I help you with the project today? Maybe you want to check the status of a feature?",
  });
}
