/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createGitVcsAdapter } from "../adapters/git/index.js";
import { createGitHubHarvestAdapter } from "../adapters/github/index.js";
import { createHarvestExecutionAdapter } from "../adapters/harvest/index.js";
import { createSlackNotificationAdapter } from "../adapters/notifications/index.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import {
  type OutboxDeliveryService,
  createOutboxDeliveryService,
} from "../application/delivery/outbox.js";
import {
  type DurableHarvestService,
  createDurableHarvestService,
} from "../application/harvest/index.js";
import { type IssueRecord, updateIssue, upsertIssue } from "../db/issues.js";
import { harvestFeature } from "../engine/harvest.js";
import {
  associateIssueWithFeature,
  notifyIssueOpened,
} from "../engine/issues.js";
import type { HarvestRecord } from "../engine/types.js";
import type {
  ClockPort,
  GitHubHarvestPort,
  HarvestExecutionPort,
  OperationsStorePort,
} from "../ports/operations-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsHarvestExtensions, VcsPort } from "../ports/vcs-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { parseFeatureBranch } from "../utils/feature-branch.js";
import { syncTrunkForHarvest } from "../utils/git.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { DispatchLedgerScope } from "./dispatch.js";

export interface GithubWebhookPluginOptions {
  config: GwrkConfig;
  projectRoot: string;
  ledger?: DispatchLedgerScope;
  gitEnv?: () => NodeJS.ProcessEnv;
  harvestService?: DurableHarvestService;
  store?: OperationsStorePort;
  registry?: ProjectRegistryPort;
  github?: GitHubHarvestPort;
  vcs?: VcsHarvestExtensions & Partial<Pick<VcsPort, "discoverIdentityFacts">>;
  executor?: HarvestExecutionPort;
  outbox?: OutboxDeliveryService;
  clock?: ClockPort;
  ownerId?: string;
  autoResume?: boolean;
}

export async function githubWebhookPlugin(
  fastify: FastifyInstance,
  options: GithubWebhookPluginOptions,
) {
  const { config, projectRoot, ledger, gitEnv } = options;
  const shutdown = new AbortController();
  const issueNotifier = createSlackNotificationAdapter({
    projectRoot,
    signal: shutdown.signal,
    transportTimeoutMs: 5_000,
  });
  const issueDeliveries = new Set<Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  const rawBodies = new WeakMap<FastifyRequest, Buffer>();
  const githubPort = options.github ?? createGitHubHarvestAdapter();
  const clock: ClockPort = options.clock ?? {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
  const ownerId =
    options.ownerId ??
    `webhook:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

  const hasExplicitDurable = Boolean(
    options.harvestService || options.store || options.registry,
  );
  const durableRegistry =
    options.registry ??
    (ledger?.db
      ? createSqliteProjectRegistryAdapter({ db: ledger.db })
      : undefined);
  const durableStore =
    options.store ??
    (ledger?.db
      ? createSqliteOperationsStoreAdapter({ db: ledger.db })
      : undefined);
  const durableHarvestService: DurableHarvestService | undefined =
    options.harvestService ??
    (durableStore && durableRegistry
      ? createDurableHarvestService({
          store: durableStore,
          registry: durableRegistry,
          vcs: options.vcs ?? createGitVcsAdapter(),
          github: githubPort,
          executor:
            options.executor ??
            createHarvestExecutionAdapter({ db: ledger?.db }),
          outbox:
            options.outbox ??
            createOutboxDeliveryService({
              store: durableStore,
              registry: durableRegistry,
              notifier: issueNotifier,
              clock,
              newId: () => crypto.randomUUID(),
            }),
          clock,
        })
      : undefined);

  fastify.addHook("preClose", async () => {
    shutdown.abort();
    await Promise.allSettled(issueDeliveries);
  });
  fastify.addHook("onClose", async () => {
    await Promise.all(inFlight);
  });

  await fastify.register(async function webhookScope(scoped) {
    scoped.removeContentTypeParser("application/json");
    scoped.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
        rawBodies.set(request, raw);
        if (raw.length === 0) {
          done(null, {});
          return;
        }
        try {
          done(null, JSON.parse(raw.toString("utf8")));
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          (err as Error & { statusCode?: number }).statusCode = 400;
          done(err);
        }
      },
    );

    scoped.post("/webhook/github", async (request, reply) => {
      const signature = request.headers["x-hub-signature-256"] as
        | string
        | undefined;
      const event = request.headers["x-github-event"] as string | undefined;
      const deliveryId = request.headers["x-github-delivery"] as
        | string
        | undefined;

      if (!event) {
        return reply.status(400).send({ error: "Missing X-GitHub-Event" });
      }

      const rawBody =
        rawBodies.get(request) ??
        Buffer.from(
          typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body ?? {}),
          "utf8",
        );

      // 1. Raw-body HMAC signature verification (FR-H01, TC-H03, FR-002)
      if (config.server.githubWebhookSecret) {
        if (!signature) {
          return reply.status(401).send({ error: "Missing signature" });
        }

        if (
          !githubPort.verifyWebhookSignature(
            rawBody,
            signature,
            config.server.githubWebhookSecret,
          )
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

        if (
          action === "opened" ||
          action === "labeled" ||
          action === "closed"
        ) {
          // FR-H13: Issue-to-feature association
          const featureId = associateIssueWithFeature(
            {
              title: issue.title,
              labels: issue.labels?.map((l: { name: string }) => l.name) || [],
            },
            projectRoot,
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
            body: issue.body,
            state: issue.state,
            html_url: issue.html_url,
            created_at: issue.created_at,
            closed_at: issue.closed_at,
            author: issue.user?.login || "unknown",
          };

          const projectId = ledger?.projectId ?? resolveProjectId(projectRoot);

          // FR-H14: Record in issues table
          if (action === "opened" || action === "labeled") {
            upsertIssue(record, projectId, ledger?.db);
            // FR-H15: Slack notification
            if (action === "opened") {
              const delivery = notifyIssueOpened(record, issueNotifier);
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
              projectId,
              { state: "closed", closed_at: issue.closed_at },
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

      const useDurableIntake =
        Boolean(durableHarvestService) &&
        (hasExplicitDurable ||
          Boolean(deliveryId?.trim()) ||
          (durableRegistry?.listProjects().length ?? 0) > 0);

      if (useDurableIntake && durableHarvestService) {
        const result = await durableHarvestService.ingestWebhook({
          deliveryId: deliveryId ?? "",
          eventType: event,
          rawBody,
          signatureHeader: signature,
          webhookSecret: config.server.githubWebhookSecret,
          parsedPayload: payload,
        });

        if (!result.accepted) {
          return reply.status(result.httpStatus).send({
            status: result.httpStatus === 200 ? "ignored" : "rejected",
            deliveryId: deliveryId ?? null,
            reason: result.reason,
          });
        }

        if (options.autoResume !== false) {
          const resume = durableHarvestService
            .resumeIncomplete(ownerId)
            .then(() => undefined)
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              fastify.log.error(
                `Durable harvest resume failed for ${result.summary.operationId}: ${msg}`,
              );
            })
            .finally(() => inFlight.delete(resume));
          inFlight.add(resume);
        }

        return reply.status(200).send({
          status: "accepted",
          deliveryId,
          operationId: result.summary.operationId,
          projectId: result.summary.projectId,
          workKey: result.summary.workKey,
          deduplicatedTransport: result.summary.deduplicatedTransport,
          deduplicatedWork: result.summary.deduplicatedWork,
          operationStatus: result.summary.status,
        });
      }

      // Legacy fallback for unenrolled fixtures without durable registry/delivery headers
      if (payload.action !== "closed") {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "not_closed_action" });
      }

      const pr = payload.pull_request;
      if (!pr) {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "missing_pull_request" });
      }

      const baseRef = pr.base?.ref;
      const headRef = pr.head?.ref;

      // Harvest MUST only trigger on phase rollup PRs targeting trunk
      if (baseRef !== "main" && baseRef !== "develop") {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "not_trunk_target" });
      }

      const parsed = parseFeatureBranch(headRef);
      if (!parsed) {
        return reply
          .status(200)
          .send({ status: "ignored", reason: "not_feat_branch" });
      }
      const { featureId, phaseId } = parsed;
      const isMerged = Boolean(pr.merged);

      const record: HarvestRecord = {
        featureId,
        phaseId,
        prNumber: pr.number,
        prUrl: pr.html_url,
        mergeCommitSha: isMerged ? pr.merge_commit_sha : "",
        mergedAt: isMerged ? pr.merged_at : pr.closed_at,
        mergedBy: pr.merged_by?.login || "unknown",
        status: isMerged ? "merged" : "closed",
        headBranch: headRef,
      };

      const env = gitEnv?.();
      if (isMerged) {
        syncTrunkForHarvest(projectRoot, baseRef, env);
      }
      const harvest = harvestFeature(projectRoot, record, ledger, env)
        .then(() => {
          fastify.log.info(`Harvest complete for ${featureId}`);
        })
        .catch((err) => {
          fastify.log.error(`Harvest failed for ${featureId}: ${err.message}`);
        })
        .finally(() => inFlight.delete(harvest));
      inFlight.add(harvest);

      return reply.status(200).send({ status: "accepted", featureId, phaseId });
    });
  });
}
