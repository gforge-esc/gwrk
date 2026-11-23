/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import {
  logCliError,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
import { verifyEnrolledCheckout } from "../adapters/git/project-id.js";
import { getCompressionRecord } from "../db/compression.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../domain/project-registry.js";
import { harvestFeature } from "../engine/harvest.js";
import type { HarvestRecord } from "../engine/types.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { execCommand } from "../utils/exec.js";
import { parseFeatureBranch } from "../utils/feature-branch.js";
import { detectDefaultBranch, syncTrunkForHarvest } from "../utils/git.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { DispatchLedgerScope } from "./dispatch.js";

const GH_POLL_TIMEOUT_MS = 5_000;

export interface HarvestPullRequest {
  number: number;
  headRefName: string;
  mergedAt: string | null;
  closedAt: string | null;
  state: string;
  mergeCommit: { oid: string } | null;
  url: string;
}

export interface HarvestWatcherOptions {
  registry?: ProjectRegistryPort;
  listPullRequests?: (target: {
    projectId: string;
    projectRoot: string;
    baseBranch: string;
    repoSlug: string | null;
  }) => Promise<HarvestPullRequest[]>;
  harvest?: typeof harvestFeature;
  syncTrunk?: typeof syncTrunkForHarvest;
}

interface WatchTarget {
  projectId: string;
  projectRoot: string;
  baseBranch: string;
  repoSlug: string | null;
  project?: EnrolledProject;
}

function resolveProjectCheckout(project: EnrolledProject): string | null {
  return (
    verifyEnrolledCheckout(project, "mirrorPath") ??
    verifyEnrolledCheckout(project, "localRoot") ??
    null
  );
}

export class HarvestWatcher {
  private interval: NodeJS.Timeout | null = null;
  private inFlight?: Promise<void>;
  private stopping = false;
  private projectId: string;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
    private ledger?: DispatchLedgerScope,
    private gitEnv?: () => NodeJS.ProcessEnv,
    private options: HarvestWatcherOptions = {},
  ) {
    this.projectId = ledger?.projectId ?? resolveProjectId(this.projectRoot);
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
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    return this.inFlight;
  }

  private resolveTargets(): WatchTarget[] {
    if (!this.options.registry) {
      return [
        {
          projectId: this.projectId,
          projectRoot: this.projectRoot,
          baseBranch: detectDefaultBranch(this.projectRoot, "develop"),
          repoSlug: null,
        },
      ];
    }

    const targets: WatchTarget[] = [];
    for (const project of this.options.registry.listProjects()) {
      const checkout = resolveProjectCheckout(project);
      if (!checkout) {
        warnCli(
          `HarvestWatcher: Skipping project ${project.slug} (${project.projectId}) — no checkout path configured`,
        );
        continue;
      }
      targets.push({
        projectId: project.projectId,
        projectRoot: checkout,
        baseBranch: project.trunkBranch,
        repoSlug: project.repoSlug,
        project,
      });
    }
    return targets;
  }

  private async fetchPullRequests(
    target: WatchTarget,
  ): Promise<HarvestPullRequest[] | null> {
    if (this.options.listPullRequests) {
      return this.options.listPullRequests({
        projectId: target.projectId,
        projectRoot: target.projectRoot,
        baseBranch: target.baseBranch,
        repoSlug: target.repoSlug,
      });
    }

    const args = [
      "pr",
      "list",
      ...(target.repoSlug ? ["--repo", target.repoSlug] : []),
      "--state",
      "all",
      "--base",
      target.baseBranch,
      "--limit",
      "40",
      "--json",
      "number,headRefName,mergedAt,mergeCommit,url,state,closedAt",
    ];

    const result = await execCommand("gh", args, undefined, {
      cwd: target.projectRoot,
      env: this.gitEnv?.(),
      timeoutMs: GH_POLL_TIMEOUT_MS,
    });

    if (result.exitCode !== 0) {
      warnCli(
        `HarvestWatcher: Failed to query GitHub CLI (exit code ${result.exitCode}): ${result.stderr.trim()}`,
      );
      return null;
    }

    return JSON.parse(result.stdout) as HarvestPullRequest[];
  }

  async runCheck() {
    if (this.stopping) return;
    const harvest = this.options.harvest ?? harvestFeature;
    const syncTrunk = this.options.syncTrunk ?? syncTrunkForHarvest;

    try {
      const targets = this.resolveTargets();
      for (const target of targets) {
        if (this.stopping) break;
        const prs = await this.fetchPullRequests(target);
        if (!prs) continue;

        for (const pr of prs) {
          if (this.stopping) break;
          if (pr.state === "OPEN") continue;

          const headRef = pr.headRefName;
          const parsed = parseFeatureBranch(headRef);
          if (!parsed) continue;
          const { featureId, phaseId } = parsed;

          if (phaseId) {
            const existing = getCompressionRecord(
              featureId,
              phaseId,
              target.projectId,
              this.ledger?.db,
            );
            if (existing) {
              continue;
            }
          }

          const commitSha = pr.mergeCommit?.oid || "unknown";
          const isMerged = pr.state === "MERGED";
          const prStatus = isMerged ? "merged" : "closed";
          const timestamp = isMerged
            ? pr.mergedAt || new Date().toISOString()
            : pr.closedAt || new Date().toISOString();

          let recipient: DeliveryRecipient | undefined;
          if (target.project?.slack) {
            const slackBinding = target.project.slack;
            const storedThread = this.options.registry?.getFeatureThread(
              target.project.projectId,
              featureId,
            );
            const validStoredThread =
              storedThread &&
              storedThread.workspaceId === slackBinding.workspaceId &&
              storedThread.channelId === slackBinding.channelId
                ? storedThread
                : undefined;
            recipient = {
              projectId: target.project.projectId,
              surface: "slack",
              workspaceId: slackBinding.workspaceId,
              channelId: slackBinding.channelId,
              threadTs: validStoredThread?.rootTs,
            };
          }

          logCliOutput(
            `HarvestWatcher: Found ${prStatus} PR #${pr.number} for ${featureId} (${phaseId || "all phases"}). Starting harvest...`,
          );

          const record: HarvestRecord = {
            projectId: target.projectId,
            ...(recipient ? { recipient } : {}),
            featureId,
            phaseId,
            prNumber: pr.number,
            prUrl: pr.url,
            mergeCommitSha: commitSha,
            mergedAt: timestamp,
            mergedBy: "HarvestWatcher",
            status: prStatus,
            headBranch: headRef,
          };

          try {
            const env = this.gitEnv?.();
            syncTrunk(target.projectRoot, target.baseBranch, env);
            await harvest(
              target.projectRoot,
              record,
              {
                projectId: target.projectId,
                db: this.ledger?.db,
                ...(target.project ? { project: target.project } : {}),
                recipient,
              },
              env,
            );
            logCliOutput(
              `HarvestWatcher: Completed harvest for ${featureId} (${phaseId || "all phases"})`,
            );
          } catch (err) {
            logCliError(`HarvestWatcher: Failed to harvest ${featureId}:`, err);
          }
        }
      }
    } catch (err) {
      logCliError("HarvestWatcher: Error in runCheck:", err);
    }
  }
}
