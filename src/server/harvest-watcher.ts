/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import {
  logCliError,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
import { getCompressionRecord } from "../db/compression.js";
import { harvestFeature } from "../engine/harvest.js";
import type { HarvestRecord } from "../engine/types.js";
import type { GwrkConfig } from "../utils/config.js";
import { execCommand } from "../utils/exec.js";
import { parseFeatureBranch } from "../utils/feature-branch.js";
import { detectDefaultBranch, syncTrunkForHarvest } from "../utils/git.js";
import { resolveProjectId } from "../utils/project-id.js";
import type { DispatchLedgerScope } from "./dispatch.js";

export class HarvestWatcher {
  private interval: NodeJS.Timeout | null = null;
  private inFlight?: Promise<void>;
  private projectId: string;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
    private ledger?: DispatchLedgerScope,
    private gitEnv?: () => NodeJS.ProcessEnv,
  ) {
    this.projectId = ledger?.projectId ?? resolveProjectId(this.projectRoot);
  }

  start() {
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
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    return this.inFlight;
  }

  async runCheck() {
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
        { cwd: this.projectRoot, env },
      );

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
