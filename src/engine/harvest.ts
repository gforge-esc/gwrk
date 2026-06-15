import fs from "node:fs";
import path from "node:path";
import { getCompressionRecord, recordCompression } from "../db/compression.js";
import { finishRun, listRuns } from "../db/runs.js";
import { loadConfig } from "../utils/config.js";
import { commitFiles, deleteRemoteBranch } from "../utils/git.js";
import { parsePlan } from "../utils/parser.js";
import {
  computeCompression,
  gatherDeliveryActuals,
} from "./compression.js";
import { computeLeadingIndicators } from "./indicators.js";
import { reconcileGates } from "./reconcile-gates.js";
import { resolveRoleMultipliers } from "./roles.js";
import { resolveProjectId } from "../utils/project-id.js";
import type {
  CompressionReport,
  EffortForecast,
  HarvestRecord,
} from "./types.js";

interface LogEntry {
  runId: string | number;
  phase?: string;
  agent?: string;
  timestamp: string;
  size: number;
  file: string;
}

export interface LogIndex {
  featureId: string;
  logs: LogEntry[];
}

/**
 * Finalizes logs for a feature: indexes them and commits to git.
 * (FR-H02)
 */
export async function finalizeLogs(
  featureId: string,
  projectPath: string,
): Promise<void> {
  const runsDir = path.join("specs", featureId, ".gwrk", "runs");
  const fullRunsDir = path.join(projectPath, runsDir);

  if (!fs.existsSync(fullRunsDir)) return;

  const indexPath = path.join(fullRunsDir, "index.json");
  let index: LogIndex = { featureId, logs: [] };

  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch (_e) {
      // Re-create if corrupt
    }
  }

  const files = fs.readdirSync(fullRunsDir).filter((f) => f.endsWith(".log"));
  const stagedFiles: string[] = [];

  for (const file of files) {
    const filePath = path.join(runsDir, file);
    const fullPath = path.join(fullRunsDir, file);

    // Always add all log files to git stage to be sure they are tracked
    stagedFiles.push(filePath);

    if (index.logs.some((l) => l.file === file)) continue;

    const stats = fs.statSync(fullPath);

    // Attempt to extract metadata from filename
    // Expected format: <timestamp>-<runId>-<phase>-<agent>.log
    const nameParts = file.replace(".log", "").split("-");
    const entry: LogEntry = {
      timestamp: nameParts[0] || new Date(stats.mtime).toISOString(),
      runId: nameParts[1] || "unknown",
      phase: nameParts[2] || "unknown",
      agent: nameParts[3] || "unknown",
      size: stats.size,
      file,
    };

    index.logs.push(entry);
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  stagedFiles.push(path.join(runsDir, "index.json"));

  commitFiles(
    projectPath,
    stagedFiles,
    `harvest: finalize logs for ${featureId}`,
    { skipHooks: true },
  );
}

/**
 * Orchestrate the post-merge harvest for a feature phase.
 * (FR-H01, FR-H03, FR-H04, FR-H05, FR-H06, FR-H07, FR-H08)
 */
export async function harvestFeature(
  projectPath: string,
  record: HarvestRecord,
): Promise<CompressionReport | undefined> {
  const { featureId, phaseId, mergeCommitSha, prNumber, mergedAt, status } =
    record;

  const projectId = resolveProjectId(projectPath);

  // 0. Idempotency Guard (FR-H10)
  if (phaseId) {
    const existing = getCompressionRecord(featureId, phaseId, projectId);
    if (existing) {
      console.log(
        `Harvest already completed for ${featureId} ${phaseId}, skipping.`,
      );
      return;
    }
  }

  // 1. Finalize Logs (FR-H02)
  try {
    await finalizeLogs(featureId, projectPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Log finalization failed (non-fatal): ${msg}`);
  }

  // 2. Finalize DB Run Records (FR-H03)
  const runs = listRuns(featureId, projectId);
  const targetRun = runs.find(
    (r) =>
      r.phase_id === phaseId &&
      (r.pr_number === prNumber || !r.pr_number) &&
      r.status !== "merged",
  );


  if (targetRun?.id) {
    finishRun(targetRun.id, {
      status: "merged",
      merge_commit_sha: mergeCommitSha,
      finished_at: mergedAt,
    });
  } else {
    console.warn(
      `No matching pending run found for harvest: feature=${featureId}, phase=${phaseId}, PR=${prNumber}`,
    );
  }

  // 2.2 Phase Completion Check (FR-H09)
  // If this phase has multiple runs (e.g. parallel dispatch), only proceed if ALL are merged.
  if (phaseId) {
    const pendingRuns = runs.filter(
      (r) =>
        r.phase_id === phaseId &&
        r.id !== targetRun?.id && // skip the one we just finished
        r.status !== "merged" &&
        r.status !== "closed",
    );

    if (pendingRuns.length > 0) {
      console.log(
        `Phase ${phaseId} has ${pendingRuns.length} pending runs, skipping phase finalization.`,
      );
      return;
    }
  }

  // 2.5 Gate Reconciliation — run gates, persist evidence, update tasks.json
  if (phaseId) {
    try {
      const result = await reconcileGates(projectPath, featureId, phaseId);
      console.log(
        `Gate reconciliation: ${result.passed}/${result.total} passed${result.failed > 0 ? ` (${result.failed} failed)` : ""}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Gate reconciliation failed (non-fatal): ${msg}`);
    }
  }

  let report: CompressionReport | undefined;

  // 3. Compression Engine (FR-H04, FR-H05)
  if (phaseId) {
    try {
      const featureDir = path.join(projectPath, "specs", featureId);
      const planPath = path.join(featureDir, "plan.md");

      if (fs.existsSync(planPath)) {
        const parsedPlan = parsePlan(planPath);
        const targetPhase = parsedPlan.phases.find((p) => p.id === phaseId);

        if (targetPhase && targetPhase.sp !== undefined) {
          const config = loadConfig(projectPath);
          const roleMultipliers = resolveRoleMultipliers(config);

          // Use PE as default role if not specified, or TS
          const peRole =
            roleMultipliers.find((r) => r.role === "PE") || roleMultipliers[0];
          const hoursPerSP = peRole?.hoursPerSP || 1.5;
          const overheadFactor = 1.25;

          const estimatedHours = targetPhase.sp * hoursPerSP * overheadFactor;
          const estimatedDays = estimatedHours / 8;

          const forecast: EffortForecast = {
            totalSP: targetPhase.sp,
            roles: [{ role: peRole?.role || "PE", sp: targetPhase.sp }],
            estimatedHours,
            estimatedDays,
          };

          const actuals = gatherDeliveryActuals(featureDir, 30, prNumber);
          const compression = computeCompression(forecast, actuals);
          const indicators = computeLeadingIndicators(
            featureId,
            forecast,
            projectId,
          );

          report = {
            featureId,
            phaseId,
            generatedAt: new Date().toISOString(),
            forecast,
            actuals,
            compression,
            indicators,
          };

          recordCompression(report, projectId);
          console.log(
            `Recorded compression for ${featureId} ${phaseId}: point=${compression.pointCompression.toFixed(1)}x`,
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to calculate compression for ${featureId}: ${msg}`);
    }
  }

  // 4. Slack Done-Done (FR-H07)
  if (report) {
    await notifyDoneDone(report);
  }

  // 5. Branch Cleanup (FR-H08)
  if (status === "merged" && record.headBranch) {
    await cleanupBranch(record.headBranch, projectPath);
  }

  return report;
}

/**
 * Posts the "🏆 Done, Done!" notification to Slack.
 * (FR-H07)
 */
export async function notifyDoneDone(report: CompressionReport): Promise<void> {
  const { MessageBuilder } = await import("../server/slack-messages.js");
  const { notifySlack } = await import("../server/slack-notify.js");
  const message = MessageBuilder.doneDone(report.featureId, report);
  await notifySlack(message, undefined, { opsOnly: true });
}

/**
 * Deletes the merged branch from origin.
 * (FR-H08)
 */
export async function cleanupBranch(
  branchName: string,
  projectPath: string,
): Promise<void> {
  deleteRemoteBranch(projectPath, branchName);
}
