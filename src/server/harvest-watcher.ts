import { execCommand } from "../utils/exec.js";
import { harvestFeature } from "../engine/harvest.js";
import { getCompressionRecord } from "../db/compression.js";
import type { HarvestRecord } from "../engine/types.js";
import type { GwrkConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";
import { detectDefaultBranch } from "../utils/git.js";
import type { App } from "@slack/bolt";

export class HarvestWatcher {
  private interval: NodeJS.Timeout | null = null;
  private projectId: string;

  constructor(
    private config: GwrkConfig,
    private slackApp: App | null,
    private projectRoot: string = process.cwd(),
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

  async runCheck() {
    try {
      const baseBranch = detectDefaultBranch(this.projectRoot, "develop");

      // Execute GitHub CLI command to get merged PRs
      const result = await execCommand("gh", [
        "pr",
        "list",
        "--state",
        "merged",
        "--base",
        baseBranch,
        "--limit",
        "20",
        "--json",
        "number,headRefName,mergedAt,mergeCommit,url",
      ], undefined, { cwd: this.projectRoot });

      if (result.exitCode !== 0) {
        // Log at warn/debug level; don't throw to prevent daemon crash
        console.warn(`HarvestWatcher: Failed to query GitHub CLI (exit code ${result.exitCode}): ${result.stderr.trim()}`);
        return;
      }

      const prs = JSON.parse(result.stdout) as Array<{
        number: number;
        headRefName: string;
        mergedAt: string;
        mergeCommit: { oid: string } | null;
        url: string;
      }>;

      for (const pr of prs) {
        // Target branch check: must be a feature branch or phase branch
        if (!pr.headRefName.startsWith("feat/") && !pr.headRefName.startsWith("phase/")) {
          continue;
        }

        const headRef = pr.headRefName;
        const branchName = headRef.replace(/^(feat|phase)\//, "");

        let featureId = branchName;
        let phaseId: string | undefined;

        // e.g. 014-plugin-system-phase-01 -> featureId: 014-plugin-system, phaseId: phase-01
        const phaseMatch = branchName.match(/(.+)-phase-(\d+)$/);
        if (phaseMatch) {
          featureId = phaseMatch[1];
          phaseId = `phase-${phaseMatch[2].padStart(2, "0")}`;
        }

        // Idempotency Guard (FR-H10): Check if already harvested
        if (phaseId) {
          const existing = getCompressionRecord(featureId, phaseId, this.projectId);
          if (existing) {
            continue; // Already processed
          }
        }

        const commitSha = pr.mergeCommit?.oid || "unknown";

        console.log(`HarvestWatcher: Found merged PR #${pr.number} for ${featureId} (${phaseId || "all phases"}). Starting harvest...`);

        const record: HarvestRecord = {
          featureId,
          phaseId,
          prNumber: pr.number,
          prUrl: pr.url,
          mergeCommitSha: commitSha,
          mergedAt: pr.mergedAt,
          mergedBy: "HarvestWatcher",
          status: "merged",
          headBranch: headRef,
        };

        try {
          await harvestFeature(this.projectRoot, record);
          console.log(`HarvestWatcher: Completed harvest for ${featureId} (${phaseId || "all phases"})`);
        } catch (err) {
          console.error(`HarvestWatcher: Failed to harvest ${featureId}:`, err);
        }
      }
    } catch (err) {
      console.error("HarvestWatcher: Error in runCheck:", err);
    }
  }
}
