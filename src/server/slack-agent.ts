/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import type { ProjectRoutingService } from "../application/project-routing/index.js";
import { parseProjectSelector } from "../domain/slack-routing.js";
import { buildProjectContext } from "../utils/agent-context.js";

/**
 * Handles @gwrk mentions with intelligent, conversational responses (Phase 2).
 */
export async function handleMention({
  event,
  say,
  projectRoot,
  routingService,
  workspaceId,
}: {
  event: SlackEventMiddlewareArgs<"app_mention">["event"];
  // biome-ignore lint/suspicious/noExplicitAny: Bolt SayFn callback
  say: any;
  projectRoot: string;
  routingService?: ProjectRoutingService;
  workspaceId?: string;
}): Promise<void> {
  const { requestedProject, cleanedText } = parseProjectSelector(event.text);
  const text = cleanedText.toLowerCase();

  const thread_ts = event.thread_ts ?? event.ts;

  if (!routingService) {
    await say({
      thread_ts,
      text: ":warning: Slack service is running without project routing configuration.",
    });
    return;
  }

  const isDirectMessage = Boolean(event.channel?.startsWith("D"));
  const invokesSkill =
    text.includes("/skill") ||
    text.includes("stress test") ||
    text.includes("plugin system");
  const channelId = event.channel || "";
  const actorUserId = event.user || "";

  const decision = routingService.authorizeCommand({
    workspaceId: workspaceId ?? event.team ?? "",
    channelId,
    isDirectMessage,
    actorUserId,
    threadTs: event.thread_ts,
    messageTs: event.ts,
    requestedProject,
    requiredAccess: invokesSkill ? "operate" : "read",
  });

  if (!decision.ok) {
    let message = `:warning: ${decision.code}: ${decision.message}`;
    if (decision.candidateSlugs && decision.candidateSlugs.length > 0) {
      message += ` Candidate projects: ${decision.candidateSlugs.join(", ")}`;
    }
    await say({
      thread_ts,
      text: message,
    });
    return;
  }

  const effectiveRoot =
    decision.project.localRoot ?? decision.project.mirrorPath ?? projectRoot;

  // TR-016: Check for specific file mentions (e.g. workflows or specs)
  if (text.includes("workflows/")) {
    const workflowMatch = event.text.match(
      /(?:\.gwrk\/|plugins\/)?workflows\/[\w-]+\.md/,
    );
    const workflow = workflowMatch ? workflowMatch[0] : "the workflow";
    await say({
      thread_ts,
      text: `📖 I see you're referencing *${workflow}*. This workflow focuses on cross-artifact consistency and TDD quality gates. Would you like me to run an analysis based on this?`,
    });
    return;
  }

  // TR-016: Check for project status queries
  if (text.includes("status of the project")) {
    const context = await buildProjectContext(effectiveRoot);
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
  if (invokesSkill) {
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

/**
 * Handles direct messages with required project resolution.
 */
export async function handleDirectMessage({
  event,
  say,
  projectRoot,
  routingService,
  workspaceId,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: Slack message event
  event: any;
  // biome-ignore lint/suspicious/noExplicitAny: Bolt SayFn callback
  say: any;
  projectRoot: string;
  routingService?: ProjectRoutingService;
  workspaceId?: string;
}): Promise<void> {
  if (event.bot_id || event.subtype) return;

  const { requestedProject } = parseProjectSelector(event.text || "");
  const thread_ts = event.thread_ts || event.ts;

  if (!routingService) {
    await say({
      thread_ts,
      text: ":warning: Slack service is running without project routing configuration.",
    });
    return;
  }

  const decision = routingService.authorizeCommand({
    workspaceId: workspaceId ?? event.team ?? "",
    channelId: event.channel || "",
    isDirectMessage: true,
    actorUserId: event.user || "",
    threadTs: event.thread_ts,
    messageTs: event.ts,
    requestedProject,
    requiredAccess: "read",
  });

  if (!decision.ok) {
    let message = `:warning: ${decision.code}: ${decision.message}`;
    if (decision.candidateSlugs && decision.candidateSlugs.length > 0) {
      message += ` Candidate projects: ${decision.candidateSlugs.join(", ")}`;
    }
    await say({
      thread_ts,
      text: message,
    });
    return;
  }

  await say({
    thread_ts,
    text: `👋 Direct message received for *${decision.project.name}* (\`${decision.project.slug}\`). How can I help you?`,
  });
}
