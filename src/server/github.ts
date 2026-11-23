/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { verifyEnrolledCheckout } from "../adapters/git/project-id.js";
import { createSlackNotificationAdapter } from "../adapters/notifications/index.js";
import { type IssueRecord, updateIssue, upsertIssue } from "../db/issues.js";
import { normalizeGitRemoteSlug } from "../domain/project-id.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../domain/project-registry.js";
import { harvestFeature } from "../engine/harvest.js";
import {
  associateIssueWithFeature,
  notifyIssueOpened,
} from "../engine/issues.js";
import type { HarvestRecord } from "../engine/types.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsPort } from "../ports/vcs-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { parseFeatureBranch } from "../utils/feature-branch.js";
import { syncTrunkForHarvest } from "../utils/git.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { DispatchLedgerScope } from "./dispatch.js";

interface GitHubWebhookRepository {
  full_name?: string;
}

interface GitHubWebhookIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  html_url?: string | null;
  created_at: string;
  closed_at?: string | null;
  user?: { login?: string };
  labels?: Array<{ name: string }>;
}

interface GitHubWebhookPullRequest {
  number: number;
  merged?: boolean;
  html_url?: string;
  merge_commit_sha?: string;
  merged_at?: string;
  merged_by?: { login?: string } | null;
  head?: { ref?: string };
  base?: { ref?: string };
}

interface GitHubWebhookPayload {
  action?: string;
  repository?: GitHubWebhookRepository;
  issue?: GitHubWebhookIssue;
  pull_request?: GitHubWebhookPullRequest;
}

export interface GithubWebhookPluginOptions {
  config: GwrkConfig;
  projectRoot: string;
  registry?: ProjectRegistryPort;
  vcs?: VcsPort;
  ledger?: DispatchLedgerScope;
  gitEnv?: () => NodeJS.ProcessEnv;
}

function resolveEnrolledCheckout(project: EnrolledProject): string | null {
  return (
    verifyEnrolledCheckout(project, "mirrorPath") ??
    verifyEnrolledCheckout(project, "localRoot") ??
    null
  );
}

function normalizeExpectedRepository(
  repo: string | null | undefined,
): string | undefined {
  if (!repo) return undefined;
  const slug = normalizeGitRemoteSlug(repo);
  if (!slug) return undefined;
  return slug.split("/").length === 2 ? `github.com/${slug}` : slug;
}

function createProjectScopedIssueNotifier(
  project: EnrolledProject,
  featureId: string,
  registry?: ProjectRegistryPort,
  notificationOptions: Parameters<
    typeof createSlackNotificationAdapter
  >[0] = {},
): NotificationPort {
  const base = createSlackNotificationAdapter({
    ...notificationOptions,
    registry,
  });
  return {
    async notify(payload) {
      if (!project.slack) return undefined;
      const storedThread = registry?.getFeatureThread(
        project.projectId,
        featureId,
      );
      const validStoredThread =
        storedThread &&
        storedThread.workspaceId === project.slack.workspaceId &&
        storedThread.channelId === project.slack.channelId
          ? storedThread
          : undefined;
      const recipient: DeliveryRecipient = {
        projectId: project.projectId,
        surface: "slack",
        workspaceId: project.slack.workspaceId,
        channelId: project.slack.channelId,
        threadTs: validStoredThread?.rootTs,
      };
      return base.notify({
        ...payload,
        projectId: project.projectId,
        featureId,
        recipient,
        channel: project.slack.channelId,
        threadTs: validStoredThread?.rootTs,
      });
    },
  };
}

export async function githubWebhookPlugin(
  fastify: FastifyInstance,
  options: GithubWebhookPluginOptions,
) {
  const { config, projectRoot, registry, vcs, ledger, gitEnv } = options;
  const shutdown = new AbortController();
  const issueNotifier = createSlackNotificationAdapter({
    projectRoot,
    signal: shutdown.signal,
    transportTimeoutMs: 5_000,
  });
  const issueDeliveries = new Set<Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  fastify.addHook("preClose", async () => {
    shutdown.abort();
    await Promise.allSettled(issueDeliveries);
  });
  fastify.addHook("onClose", async () => {
    await Promise.all(inFlight);
  });

  fastify.post<{ Body: GitHubWebhookPayload }>(
    "/webhook/github",
    async (request, reply) => {
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

      const payload: GitHubWebhookPayload =
        request.body && typeof request.body === "object" ? request.body : {};
      const repoFullName = payload.repository?.full_name;

      let enrolledProject: EnrolledProject | null = null;
      if (registry) {
        enrolledProject = repoFullName
          ? registry.findByRepoSlug(repoFullName)
          : registry.findByLocalRoot(projectRoot);
        if (!enrolledProject) {
          return reply
            .status(200)
            .send({ status: "ignored", reason: "unenrolled_repository" });
        }
      }

      const targetProjectId =
        enrolledProject?.projectId ??
        ledger?.projectId ??
        resolveProjectId(projectRoot);

      // Handle Issues events (FR-H12)
      if (event === "issues") {
        const issue = payload.issue;
        const action = payload.action;

        if (
          issue &&
          (action === "opened" || action === "labeled" || action === "closed")
        ) {
          // FR-H13: Issue-to-feature association
          const issueProjectRoot =
            enrolledProject?.mirrorPath ??
            enrolledProject?.localRoot ??
            projectRoot;
          const featureId = associateIssueWithFeature(
            {
              title: issue.title,
              labels: issue.labels?.map((l) => l.name) || [],
            },
            issueProjectRoot,
          );

          if (!featureId) {
            return reply
              .status(200)
              .send({ status: "ignored", reason: "no_feature_associated" });
          }

          const record: IssueRecord = {
            issue_number: issue.number,
            feature_id: featureId,
            title: issue.title,
            body: issue.body ?? null,
            state: issue.state,
            html_url: issue.html_url,
            created_at: issue.created_at,
            closed_at: issue.closed_at,
            author: issue.user?.login || "unknown",
          };

          // FR-H14: Record in issues table
          if (action === "opened" || action === "labeled") {
            upsertIssue(record, targetProjectId, ledger?.db);
            // FR-H15: Slack notification
            if (action === "opened") {
              const delivery = notifyIssueOpened(
                record,
                enrolledProject
                  ? createProjectScopedIssueNotifier(
                      enrolledProject,
                      featureId,
                      registry,
                      {
                        projectRoot: issueProjectRoot,
                        signal: shutdown.signal,
                        transportTimeoutMs: 5_000,
                      },
                    )
                  : issueNotifier,
              );
              issueDeliveries.add(delivery);
              try {
                await delivery;
              } finally {
                issueDeliveries.delete(delivery);
              }
            }
          } else if (action === "closed") {
            updateIssue(
              issue.number,
              targetProjectId,
              {
                state: "closed",
                closed_at: issue.closed_at,
              },
              ledger?.db,
            );
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
      // Harvest MUST only trigger on phase rollup PRs targeting enrolled trunk
      const isValidTrunk = enrolledProject
        ? baseRef === enrolledProject.trunkBranch
        : baseRef === "main" || baseRef === "develop";
      if (!baseRef || !isValidTrunk) {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "not_trunk_target" });
      }

      // 4. Parse Feature (FR-H01) — shared parser, so the webhook and the poller
      // agree on phase padding and harvest stays idempotent across both (FR-H11).
      const parsed = headRef ? parseFeatureBranch(headRef) : null;
      if (!parsed || !headRef) {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "not_feat_branch" });
      }
      const { featureId, phaseId } = parsed;

      const checkoutPath = enrolledProject
        ? resolveEnrolledCheckout(enrolledProject)
        : projectRoot;
      if (!checkoutPath) {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "unverified_checkout" });
      }

      let resolvedPrUrl = pr.html_url || "";
      if (vcs) {
        const verifiedUrl = await vcs.resolvePullRequestUrl(checkoutPath, {
          prNumber: pr.number,
          headBranch: headRef,
          expectedRepository: normalizeExpectedRepository(
            enrolledProject?.repoSlug ?? repoFullName,
          ),
        });
        if (verifiedUrl) {
          resolvedPrUrl = verifiedUrl;
        }
      }

      let recipient: DeliveryRecipient | undefined;
      if (enrolledProject?.slack) {
        const storedThread = registry?.getFeatureThread(
          enrolledProject.projectId,
          featureId,
        );
        const validStoredThread =
          storedThread &&
          storedThread.workspaceId === enrolledProject.slack.workspaceId &&
          storedThread.channelId === enrolledProject.slack.channelId
            ? storedThread
            : undefined;
        recipient = {
          projectId: enrolledProject.projectId,
          surface: "slack",
          workspaceId: enrolledProject.slack.workspaceId,
          channelId: enrolledProject.slack.channelId,
          threadTs: validStoredThread?.rootTs,
        };
      }

      const record: HarvestRecord = {
        projectId: targetProjectId,
        ...(recipient ? { recipient } : {}),
        featureId,
        phaseId,
        prNumber: pr.number,
        prUrl: resolvedPrUrl,
        mergeCommitSha: pr.merge_commit_sha || "",
        mergedAt: pr.merged_at || new Date().toISOString(),
        mergedBy: pr.merged_by?.login || "unknown",
        status: "merged",
        headBranch: headRef,
      };

      // 5. Trigger Harvest (FR-H01)
      const env = gitEnv?.();
      syncTrunkForHarvest(checkoutPath, baseRef, env);
      const harvest = harvestFeature(
        checkoutPath,
        record,
        {
          projectId: targetProjectId,
          db: ledger?.db,
          ...(enrolledProject ? { project: enrolledProject } : {}),
          recipient,
        },
        env,
      )
        .then(() => {
          fastify.log.info(`Harvest complete for ${featureId}`);
        })
        .catch((err) => {
          fastify.log.error(`Harvest failed for ${featureId}: ${err.message}`);
        })
        .finally(() => inFlight.delete(harvest));
      inFlight.add(harvest);

      return reply.status(200).send({
        status: "accepted",
        projectId: targetProjectId,
        featureId,
        phaseId,
      });
    },
  );
}
