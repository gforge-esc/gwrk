import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { type IssueRecord, saveIssue, updateIssue } from "../db/issues.js";
import { harvestFeature } from "../engine/harvest.js";
import {
  associateIssueWithFeature,
  notifyIssueOpened,
} from "../engine/issues.js";
import type { HarvestRecord } from "../engine/types.js";
import type { GwrkConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";

export async function githubWebhookPlugin(
  fastify: FastifyInstance,
  options: { config: GwrkConfig; projectRoot: string },
) {
  const { config, projectRoot } = options;

  fastify.post("/webhook/github", async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"] as string;
    const event = request.headers["x-github-event"] as string;

    if (!event) {
      return reply.status(400).send({ error: "Missing X-GitHub-Event" });
    }

    // 1. Signature Verification (FR-H01, TC-H03, FR-H12)
    if (config.server.githubWebhookSecret) {
      if (!signature) {
        return reply.status(401).send({ error: "Missing signature" });
      }

      const hmac = crypto.createHmac(
        "sha256",
        config.server.githubWebhookSecret,
      );
      const digest = `sha256=${hmac.update(JSON.stringify(request.body)).digest("hex")}`;

      const digestBuffer = Buffer.from(digest);
      const signatureBuffer = Buffer.from(signature);

      if (
        digestBuffer.length !== signatureBuffer.length ||
        !crypto.timingSafeEqual(digestBuffer, signatureBuffer)
      ) {
        return reply.status(401).send({ error: "Invalid signature" });
      }
    }

    // biome-ignore lint/suspicious/noExplicitAny: Fastify request body parsing
    const payload = request.body as any;

    // Handle Issues events (FR-H12)
    if (event === "issues") {
      const issue = payload.issue;
      const action = payload.action;

      if (action === "opened" || action === "labeled" || action === "closed") {
        // FR-H13: Issue-to-feature association
        const featureId = associateIssueWithFeature({
          title: issue.title,
          labels: issue.labels?.map((l: any) => l.name) || [],
        });

        if (!featureId) {
          return reply
            .status(200)
            .send({ status: "ignored", reason: "no_feature_associated" });
        }

        const record: IssueRecord = {
          issue_number: issue.number,
          feature_id: featureId,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          html_url: issue.html_url,
          created_at: issue.created_at,
          closed_at: issue.closed_at,
          author: issue.user?.login || "unknown",
        };

        const projectId = resolveProjectId(projectRoot);

        // FR-H14: Record in issues table
        if (action === "opened" || action === "labeled") {
          saveIssue(record, projectId);
          // FR-H15: Slack notification
          if (action === "opened") {
            await notifyIssueOpened(record);
          }
        } else if (action === "closed") {
          updateIssue(issue.number, {
            state: "closed",
            closed_at: issue.closed_at,
          });
        }

        return reply
          .status(200)
          .send({ status: "accepted", featureId, issueNumber: issue.number });
      }

      return reply
        .status(200)
        .send({ status: "ignored", reason: "unsupported_issue_action" });
    }

    // Only process pull_request events
    if (event !== "pull_request") {
      return reply
        .status(200)
        .send({ status: "ignored", reason: "unsupported_event" });
    }

    // 2. Filter Actions (FR-H01)
    if (payload.action !== "closed" || !payload.pull_request?.merged) {
      return reply
        .status(200)
        .send({ status: "ignored", reason: "not_merged_closure" });
    }

    const pr = payload.pull_request;
    const baseRef = pr.base?.ref;
    const headRef = pr.head?.ref;

    // 3. Filter Branches (FR-H01)
    // Harvest MUST only trigger on phase rollup PRs targeting trunk
    if (baseRef !== "main" && baseRef !== "develop") {
      return reply
        .status(200)
        .send({ status: "ignored", reason: "not_trunk_target" });
    }

    // 4. Parse Feature (FR-H01)
    if (!headRef?.startsWith("feat/")) {
      return reply
        .status(200)
        .send({ status: "ignored", reason: "not_feat_branch" });
    }

    const branchName = headRef.replace("feat/", "");
    let featureId: string;
    let phaseId: string | undefined;

    const phaseMatch = branchName.match(/(.+)-phase-(\d+)$/);
    if (phaseMatch) {
      featureId = phaseMatch[1];
      phaseId = `phase-${phaseMatch[2]}`;
    } else {
      featureId = branchName;
    }

    const record: HarvestRecord = {
      featureId,
      phaseId,
      prNumber: pr.number,
      prUrl: pr.html_url,
      mergeCommitSha: pr.merge_commit_sha,
      mergedAt: pr.merged_at,
      mergedBy: pr.merged_by?.login || "unknown",
      status: "merged",
      headBranch: headRef,
    };

    // 5. Trigger Harvest (FR-H01)
    harvestFeature(projectRoot, record)
      .then(async (_report) => {
        fastify.log.info(`Harvest complete for ${featureId}`);
      })
      .catch((err) => {
        fastify.log.error(`Harvest failed for ${featureId}: ${err.message}`);
      });

    return reply.status(200).send({ status: "accepted", featureId, phaseId });
  });
}
