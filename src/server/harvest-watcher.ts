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
  private projectId: string;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
    private options: HarvestWatcherOptions = {},
  ) {
    this.projectId = resolveProjectId(this.projectRoot);
  }

  start() {
    // Poll every 5 minutes (300000ms)
    const intervalMs = 5 * 60 * 1000;
    this.interval = setInterval(() => this.runCheck(), intervalMs);
    // Run once on startup
    this.runCheck().catch(console.error);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
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
    const harvest = this.options.harvest ?? harvestFeature;
    const syncTrunk = this.options.syncTrunk ?? syncTrunkForHarvest;

    try {
      const targets = this.resolveTargets();
      for (const target of targets) {
        const prs = await this.fetchPullRequests(target);
        if (!prs) continue;

        for (const pr of prs) {
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
            syncTrunk(target.projectRoot, target.baseBranch);
            await harvest(target.projectRoot, record);
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
