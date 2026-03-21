import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { harvestFeature } from "../engine/harvest.js";
import type { HarvestRecord } from "../engine/types.js";
import type { GwrkConfig } from "../utils/config.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";

export async function githubRoutes(
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

    // 1. Signature Verification (FR-H01, TC-H03)
    if (config.server.githubWebhookSecret) {
      if (!signature) {
        return reply.status(401).send({ error: "Missing signature" });
      }

      const hmac = crypto.createHmac("sha256", config.server.githubWebhookSecret);
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

    // Only process pull_request events
    if (event !== "pull_request") {
      return reply.status(200).send({ status: "ignored", reason: "not_pr_event" });
    }

    const payload = request.body as any;

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
      return reply.status(200).send({ status: "ignored", reason: "not_trunk_target" });
    }

    // 4. Parse Feature (FR-H01)
    if (!headRef?.startsWith("feat/")) {
      return reply.status(200).send({ status: "ignored", reason: "not_feat_branch" });
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
      .then(async (report) => {
        // 6. Slack Done-Done (FR-H07)
        const message = MessageBuilder.doneDone(featureId, report);
        await notifySlack(message, undefined, { opsOnly: true });
        fastify.log.info(`Harvest complete for ${featureId}`);
      })
      .catch((err) => {
        fastify.log.error(`Harvest failed for ${featureId}: ${err.message}`);
      });

    return reply.status(200).send({ status: "accepted", featureId, phaseId });
  });
}
