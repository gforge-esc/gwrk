/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as crypto from "node:crypto";
import type { App } from "@slack/bolt";
import {
  logCliError,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
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
import { getCompressionRecord } from "../db/compression.js";
import { harvestFeature } from "../engine/harvest.js";
import type { HarvestRecord } from "../engine/types.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  ClockPort,
  GitHubHarvestPort,
  HarvestExecutionPort,
  OperationsStorePort,
} from "../ports/operations-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsHarvestExtensions, VcsPort } from "../ports/vcs-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { execCommand } from "../utils/exec.js";
import { parseFeatureBranch } from "../utils/feature-branch.js";
import { detectDefaultBranch, syncTrunkForHarvest } from "../utils/git.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { DispatchLedgerScope } from "./dispatch.js";

const GH_POLL_TIMEOUT_MS = 5_000;

export interface DurableHarvestWatcherOptions {
  harvestService?: DurableHarvestService;
  store?: OperationsStorePort;
  registry?: ProjectRegistryPort;
  github?: GitHubHarvestPort;
  vcs?: VcsHarvestExtensions & Partial<Pick<VcsPort, "discoverIdentityFacts">>;
  executor?: HarvestExecutionPort;
  outbox?: OutboxDeliveryService;
  notifier?: NotificationPort;
  clock?: ClockPort;
  ownerId?: string;
}

export class HarvestWatcher {
  private interval: NodeJS.Timeout | null = null;
  private inFlight?: Promise<void>;
  private stopping = false;
  private projectId: string;
  private readonly ownerId: string;
  private readonly notificationShutdown = new AbortController();
  private readonly durableRegistry?: ProjectRegistryPort;
  private readonly durableOutbox?: OutboxDeliveryService;
  private readonly durableHarvestService?: DurableHarvestService;
  private readonly hasExplicitDurable: boolean;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
    private ledger?: DispatchLedgerScope,
    private gitEnv?: () => NodeJS.ProcessEnv,
    private readonly durableOptions?: DurableHarvestWatcherOptions,
  ) {
    this.projectId = ledger?.projectId ?? resolveProjectId(this.projectRoot);
    this.ownerId =
      durableOptions?.ownerId ??
      `watcher:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.hasExplicitDurable = Boolean(
      durableOptions?.harvestService ||
        durableOptions?.registry ||
        durableOptions?.store,
    );

    const db = ledger?.db;
    const store =
      durableOptions?.store ??
      (db ? createSqliteOperationsStoreAdapter({ db }) : undefined);
    const registry =
      durableOptions?.registry ??
      (db ? createSqliteProjectRegistryAdapter({ db }) : undefined);
    if (durableOptions?.harvestService) {
      this.durableHarvestService = durableOptions.harvestService;
      this.durableRegistry = registry;
      this.durableOutbox = durableOptions.outbox;
    } else if (store && registry) {
      const clock: ClockPort = durableOptions?.clock ?? {
        nowIso: () => new Date().toISOString(),
        nowMs: () => Date.now(),
      };
      const notifier =
        durableOptions?.notifier ??
        createSlackNotificationAdapter({
          projectRoot: this.projectRoot,
          signal: this.notificationShutdown.signal,
          transportTimeoutMs: 5_000,
        });
      const outbox =
        durableOptions?.outbox ??
        createOutboxDeliveryService({
          store,
          registry,
          notifier,
          clock,
          newId: () => crypto.randomUUID(),
        });
      this.durableRegistry = registry;
      this.durableOutbox = outbox;
      this.durableHarvestService = createDurableHarvestService({
        store,
        registry,
        vcs: durableOptions?.vcs ?? createGitVcsAdapter(),
        github: durableOptions?.github ?? createGitHubHarvestAdapter(),
        executor:
          durableOptions?.executor ??
          createHarvestExecutionAdapter({ db: ledger?.db }),
        outbox,
        clock,
      });
    }
  }

  start() {
    this.stopping = false;
    // Poll every 5 minutes (300000ms)
    const intervalMs = 5 * 60 * 1000;
    const check = () => {
      this.inFlight ??= this.runCheck()
        .catch(console.error)
        .finally(() => {
          this.inFlight = undefined;
        });
    };
    this.interval = setInterval(check, intervalMs);
    check();
  }

  stop(): void | Promise<void> {
    this.stopping = true;
    this.notificationShutdown.abort();
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    return this.inFlight;
  }

  async runCheck() {
    if (this.stopping) return;

    if (this.durableHarvestService && this.durableRegistry) {
      const allEnrolledProjects = this.durableRegistry.listProjects();
      const pollableProjects = allEnrolledProjects.filter((project) =>
        Boolean(project.repoSlug && (project.localRoot ?? project.mirrorPath)),
      );

      if (this.hasExplicitDurable || allEnrolledProjects.length > 0) {
        for (const project of pollableProjects) {
          if (this.stopping) break;
          try {
            const summaries = await this.durableHarvestService.pollProject(
              project,
              this.ownerId,
            );
            for (const summary of summaries) {
              logCliOutput(
                `HarvestWatcher: Polled ${project.slug} operation ${summary.operationId} (${summary.status})`,
              );
            }
          } catch (error) {
            warnCli(
              `HarvestWatcher: Durable poll failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        if (!this.stopping) {
          try {
            await this.durableHarvestService.resumeIncomplete(this.ownerId);
          } catch (error) {
            logCliError(
              "HarvestWatcher: Failed to resume incomplete harvests:",
              error,
            );
          }
        }

        if (!this.stopping && this.durableOutbox) {
          for (const project of allEnrolledProjects) {
            if (this.stopping) break;
            try {
              await this.durableOutbox.flushPendingForProject(
                project.projectId,
              );
            } catch (error) {
              warnCli(
                `HarvestWatcher: Outbox flush failed for ${project.slug}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
        return;
      }
    }

    try {
      const env = this.gitEnv?.();
      const baseBranch = detectDefaultBranch(this.projectRoot, "develop");

      // Execute GitHub CLI command to get merged and closed PRs
      const result = await execCommand(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "all",
          "--base",
          baseBranch,
          "--limit",
          "40",
          "--json",
          "number,headRefName,mergedAt,mergeCommit,url,state,closedAt",
        ],
        undefined,
        { cwd: this.projectRoot, env, timeoutMs: GH_POLL_TIMEOUT_MS },
      );

      if (this.stopping) return;
      if (result.exitCode !== 0) {
        // Log at warn/debug level; don't throw to prevent daemon crash
        warnCli(
          `HarvestWatcher: Failed to query GitHub CLI (exit code ${result.exitCode}): ${result.stderr.trim()}`,
        );
        return;
      }

      const prs = JSON.parse(result.stdout) as Array<{
        number: number;
        headRefName: string;
        mergedAt: string | null;
        closedAt: string | null;
        state: string;
        mergeCommit: { oid: string } | null;
        url: string;
      }>;

      for (const pr of prs) {
        if (this.stopping) break;
        if (pr.state === "OPEN") continue;

        const headRef = pr.headRefName;
        // Shared parser — must match the webhook path so a PR seen by both
        // yields the same phase ID and idempotency holds (FR-H11).
        const parsed = parseFeatureBranch(headRef);
        if (!parsed) continue;
        const { featureId, phaseId } = parsed;

        // Idempotency Guard (FR-H10): Check if already harvested
        if (phaseId) {
          const existing = getCompressionRecord(
            featureId,
            phaseId,
            this.projectId,
            this.ledger?.db,
          );
          if (existing) {
            continue; // Already processed
          }
        }

        const commitSha = pr.mergeCommit?.oid || "unknown";
        const isMerged = pr.state === "MERGED";
        const prStatus = isMerged ? "merged" : "closed";
        const timestamp = isMerged
          ? pr.mergedAt || new Date().toISOString()
          : pr.closedAt || new Date().toISOString();

        logCliOutput(
          `HarvestWatcher: Found ${prStatus} PR #${pr.number} for ${featureId} (${phaseId || "all phases"}). Starting harvest...`,
        );

        const record: HarvestRecord = {
          featureId,
          phaseId,
          prNumber: pr.number,
          prUrl: pr.url,
          mergeCommitSha: commitSha,
          mergedAt: timestamp, // Using mergedAt to carry the terminal timestamp (either mergedAt or closedAt)
          mergedBy: "HarvestWatcher",
          status: prStatus,
          headBranch: headRef,
        };

        try {
          syncTrunkForHarvest(this.projectRoot, baseBranch, env);
          await harvestFeature(this.projectRoot, record, this.ledger, env);
          logCliOutput(
            `HarvestWatcher: Completed harvest for ${featureId} (${phaseId || "all phases"})`,
          );
        } catch (err) {
          logCliError(`HarvestWatcher: Failed to harvest ${featureId}:`, err);
        }
      }
    } catch (err) {
      logCliError("HarvestWatcher: Error in runCheck:", err);
    }
  }
}
