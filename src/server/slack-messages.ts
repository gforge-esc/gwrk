import type { KnownBlock } from "@slack/types";
import type { PulseReport, PulseSnapshot } from "../engine/types.js";
import type { DispatchRecord } from "./types.js";

export interface SlackMessage {
  channel?: string;
  blocks: KnownBlock[];
  text: string;
}

export const MessageBuilder = {
  phaseStart(dispatch: DispatchRecord): SlackMessage {
    const text = `🚀 Phase ${dispatch.phaseId} started for ${dispatch.featureId}`;
    return {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🚀 Phase Start: ${dispatch.featureId}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Phase:* ${dispatch.phaseId}` },
            { type: "mrkdwn", text: `*Agent:* \`${dispatch.backend}\`` },
            { type: "mrkdwn", text: `*Branch:* \`${dispatch.branchName}\`` },
            { type: "mrkdwn", text: `*Status:* ${dispatch.status}` },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Created at ${new Date(dispatch.createdAt).toLocaleString()}`,
            },
          ],
        },
      ],
    };
  },

  phaseComplete(dispatch: DispatchRecord): SlackMessage {
    const text = `✅ Phase ${dispatch.phaseId} completed for ${dispatch.featureId}`;
    return {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `✅ Phase Complete: ${dispatch.featureId}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Phase:* ${dispatch.phaseId}` },
            { type: "mrkdwn", text: `*Agent:* \`${dispatch.backend}\`` },
            { type: "mrkdwn", text: `*Status:* ${dispatch.status}` },
          ],
        },
      ],
    };
  },

  reviewReady(dispatch: DispatchRecord): SlackMessage {
    const text = `🔍 Review ready for ${dispatch.featureId} (${dispatch.phaseId})`;
    const value = JSON.stringify({
      featureId: dispatch.featureId,
      phaseId: dispatch.phaseId,
    });

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🔍 Review Ready: ${dispatch.featureId}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Phase *${dispatch.phaseId}* is ready for your review. All tests passed.`,
        },
      },
    ];

    if (dispatch.prUrl) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Pull Request:* <${dispatch.prUrl}|#${dispatch.prNumber || "PR"}>`,
        },
      });
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Merge" },
          style: "primary",
          action_id: "merge_pr",
          value,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Request Changes" },
          action_id: "request_changes",
          value,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔍 View Review" },
          action_id: "view_review",
          value,
        },
      ],
    });

    return { text, blocks };
  },

  phaseFail(dispatch: DispatchRecord, error?: string): SlackMessage {
    const text = `❌ Phase ${dispatch.phaseId} failed for ${dispatch.featureId}`;
    const value = JSON.stringify({
      featureId: dispatch.featureId,
      phaseId: dispatch.phaseId,
    });

    return {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `❌ Phase Failure: ${dispatch.featureId}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Phase:* ${dispatch.phaseId}` },
            { type: "mrkdwn", text: `*Agent:* \`${dispatch.backend}\`` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Error:*\n\`\`\`${error || "Unknown error"}\`\`\``,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🔄 Retry" },
              style: "primary",
              action_id: "retry_phase",
              value,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "📋 View Logs" },
              action_id: "view_logs",
              value,
            },
          ],
        },
      ],
    };
  },

  ciResult(
    dispatch: DispatchRecord,
    ci: { passed: boolean; summary: string },
  ): SlackMessage {
    const statusIcon = ci.passed ? "✅" : "❌";
    const text = `${statusIcon} CI Results for ${dispatch.featureId}`;

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${statusIcon} CI Results: ${dispatch.featureId}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ci.summary,
        },
      },
    ];

    if (dispatch.prUrl) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Pull Request:* <${dispatch.prUrl}|#${dispatch.prNumber || "PR"}>`,
        },
      });
    }

    return { text, blocks };
  },

  pulseSummary(report: PulseReport): SlackMessage {
    const text = "📊 Pulse Daily Summary";
    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: "📊 Pulse Daily Summary" },
      },
    ];

    for (const repo of report.repositories) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${repo.repoName}*\nLOC: ${repo.mainLoc} (+${repo.draftLoc} draft)\nTrend: ${repo.weeklyBuckets.length > 0 ? "Scanned" : "New"}`,
        },
      });
    }

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Generated at ${new Date(report.generatedAt).toLocaleString()}`,
        },
      ],
    });

    return { text, blocks };
  },

  doneDone(featureId: string): SlackMessage {
    const text = `🏆 Done Done! ${featureId} is shipped.`;
    return {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🏆 Done Done!",
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Congratulations! *${featureId}* has been fully delivered and merged into the main branch.`,
          },
        },
      ],
    };
  },

  batchedSummary(events: { type: string; feature: string }[]): SlackMessage {
    const text = "🔔 Batched Notification Summary";
    const eventList = events.map((e) => `• ${e.type}: ${e.feature}`).join("\n");
    return {
      text,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🔔 Batched Summary" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `While you were away, the following events occurred:\n${eventList}`,
          },
        },
      ],
    };
  },
};
