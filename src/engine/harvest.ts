/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  logCliError,
  logCliOutput,
  warnCli,
} from "../adapters/cli/output-scope.js";
import { createGitVcsAdapter } from "../adapters/git/index.js";
import { createGitHubHarvestAdapter } from "../adapters/github/index.js";
import { createHarvestExecutionAdapter } from "../adapters/harvest/index.js";
import {
  createSlackNotificationAdapter,
  notifyHarvestComplete,
} from "../adapters/notifications/index.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
  createSqliteRunStoreAdapter,
} from "../adapters/sqlite/index.js";
import { createOutboxDeliveryService } from "../application/delivery/outbox.js";
import {
  type DurableHarvestService,
  createDurableHarvestService,
} from "../application/harvest/index.js";
import { getCompressionRecord } from "../db/compression.js";
import { openDatabase } from "../db/index.js";
import {
  finishRun,
  getFeatureRunTelemetry,
  listRuns,
  recordRun,
} from "../db/runs.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../domain/project-registry.js";
import type { NotificationPort } from "../ports/notification-port.js";
import { loadConfig } from "../utils/config.js";
import {
  commitFiles,
  deleteRemoteBranch,
  detectDefaultBranch,
} from "../utils/git.js";
import { loadManifests } from "../utils/manifest.js";
import { parsePlan } from "../utils/parser.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  computeCompression,
  computeTelemetryMetrics,
  gatherDeliveryActuals,
} from "./compression.js";
import { computeLeadingIndicators } from "./indicators.js";
import { reconcileGates } from "./reconcile-gates.js";
import { resolveRoleMultipliers } from "./roles.js";
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

export interface HarvestFeatureOptions {
  durableService?: DurableHarvestService;
  project?: EnrolledProject;
  db?: Database.Database;
  ownerId?: string;
  recipient?: DeliveryRecipient | null;
  updateLocalTaskState?: boolean;
}

const FULL_GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function buildFallbackLocalProject(
  projectPath: string,
  projectId: string,
): EnrolledProject {
  const now = new Date().toISOString();
  const trunkBranch = detectDefaultBranch(projectPath, "main");
  const slug = path.basename(projectPath) || projectId;
  return {
    projectId,
    slug,
    name: slug,
    repoSlug: null,
    trunkBranch,
    localRoot: projectPath,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local"] },
    slack: null,
    legacyProjectIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Orchestrate the post-merge harvest for a feature phase.
 * Routes through DurableHarvestService when a durable service or enrolled
 * repository checkout is available, while preserving single-project local
 * compatibility for legacy callers.
 * (FR-H01, FR-H03, FR-H04, FR-H05, FR-H06, FR-H07, FR-H08)
 */
export async function harvestFeature(
  projectPath: string,
  record: HarvestRecord,
  options?: HarvestFeatureOptions,
): Promise<CompressionReport | undefined> {
  const { featureId, phaseId, mergeCommitSha, prNumber, mergedAt, status } =
    record;

  const projectId =
    options?.project?.projectId ?? resolveProjectId(projectPath);

  if (options?.durableService) {
    const project =
      options.project ?? buildFallbackLocalProject(projectPath, projectId);
    await options.durableService.runManualHarvest({
      project,
      featureId,
      phaseId,
      prNumber: prNumber > 0 ? prNumber : undefined,
      commitSha: FULL_GIT_SHA.test(mergeCommitSha ?? "")
        ? mergeCommitSha
        : undefined,
      recipient: options.recipient ?? null,
      updateLocalTaskState: options.updateLocalTaskState ?? true,
      ownerId: options.ownerId ?? "local-harvest",
    });
    if (options.updateLocalTaskState !== false) {
      try {
        await finalizeLogs(featureId, projectPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnCli(`Log finalization failed (non-fatal): ${msg}`);
      }
    }
    return undefined;
  }

  if (
    status === "merged" &&
    FULL_GIT_SHA.test(mergeCommitSha ?? "") &&
    fs.existsSync(path.join(projectPath, ".git"))
  ) {
    let ownedDb: Database.Database | null = null;
    try {
      let db: Database.Database;
      if (options?.db) {
        db = options.db;
      } else {
        ownedDb = openDatabase();
        db = ownedDb;
      }
      const registry = createSqliteProjectRegistryAdapter({ db });
      const enrolled =
        options?.project ??
        registry.findByLocalRoot(projectPath) ??
        registry.getProject(projectId);
      if (enrolled) {
        let capturedReport: CompressionReport | undefined;
        const store = createSqliteOperationsStoreAdapter({ db });
        const clock = {
          nowIso: () => new Date().toISOString(),
          nowMs: () => Date.now(),
        };
        const outbox = createOutboxDeliveryService({
          store,
          registry,
          notifier: createSlackNotificationAdapter(),
          clock,
          newId: () => randomUUID(),
        });
        const durableService = createDurableHarvestService({
          store,
          registry,
          vcs: createGitVcsAdapter(),
          github: createGitHubHarvestAdapter(),
          executor: createHarvestExecutionAdapter({
            db,
            onCompressionReport: (report) => {
              capturedReport = report;
            },
          }),
          outbox,
          clock,
          newId: () => randomUUID(),
        });
        await durableService.runManualHarvest({
          project: enrolled,
          featureId,
          phaseId,
          prNumber: prNumber > 0 && enrolled.repoSlug ? prNumber : undefined,
          commitSha: mergeCommitSha,
          recipient: options?.recipient ?? null,
          updateLocalTaskState: options?.updateLocalTaskState ?? true,
          ownerId: options?.ownerId ?? "local-harvest",
        });
        if (options?.updateLocalTaskState !== false) {
          try {
            await finalizeLogs(featureId, projectPath);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            warnCli(`Log finalization failed (non-fatal): ${msg}`);
          }
        }
        return capturedReport;
      }
    } catch (err) {
      if (options?.project || options?.db) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      warnCli(
        `Durable harvest unavailable for local checkout; falling back to local compatibility mode: ${msg}`,
      );
    } finally {
      if (ownedDb?.open) ownedDb.close();
    }
  }

  // If no phaseId is specified, discover all phases from plan.md and run harvest for each
  if (!phaseId) {
    logCliOutput(
      `No phaseId provided for harvest on ${featureId}. Attempting to discover all phases from plan.md...`,
    );
    const featureDir = path.join(projectPath, "specs", featureId);
    const planPath = path.join(featureDir, "plan.md");
    if (fs.existsSync(planPath)) {
      try {
        const parsedPlan = parsePlan(planPath);
        logCliOutput(
          `Discovered ${parsedPlan.phases.length} phases for feature ${featureId}: ${parsedPlan.phases.map((p) => p.id).join(", ")}`,
        );
        for (const phase of parsedPlan.phases) {
          const subRecord = { ...record, phaseId: phase.id };
          logCliOutput(
            `Reconciling/Harvesting phase ${phase.id} for feature ${featureId}...`,
          );
          await harvestFeature(projectPath, subRecord, options);
        }
      } catch (err) {
        logCliError(
          `Failed to process phase-less harvest for ${featureId}:`,
          err,
        );
      }
    } else {
      warnCli(
        `No plan.md found for ${featureId} at ${planPath}, cannot process phase-less harvest.`,
      );
    }
    return;
  }

  // 0. Idempotency Guard (FR-H10)
  if (phaseId) {
    const existing = getCompressionRecord(featureId, phaseId, projectId);
    if (existing) {
      logCliOutput(
        `Harvest already completed for ${featureId} ${phaseId}, skipping.`,
      );
      return;
    }

    // Fallback: Use the run record itself as an idempotency token if compression is disabled/unimplemented
    const runs = listRuns(featureId, projectId);
    const alreadyProcessedRun = runs.find(
      (r) =>
        r.phase_id === phaseId &&
        r.pr_number === prNumber &&
        r.status === status,
    );
    if (alreadyProcessedRun) {
      logCliOutput(
        `Run for PR ${prNumber} already marked as ${status}. Skipping harvest idempotently.`,
      );
      return;
    }
  }

  // 1. Finalize Logs (FR-H02)
  if (options?.updateLocalTaskState !== false) {
    try {
      await finalizeLogs(featureId, projectPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnCli(`Log finalization failed (non-fatal): ${msg}`);
    }
  }

  // 2. Finalize DB Run Records (FR-H03)
  const runs = listRuns(featureId, projectId);

  const alreadyProcessedRun = runs.find(
    (r) =>
      r.phase_id === phaseId && r.pr_number === prNumber && r.status === status,
  );

  const targetRun = runs.find(
    (r) =>
      r.phase_id === phaseId &&
      (r.pr_number === prNumber || !r.pr_number) &&
      r.status !== "merged" &&
      r.status !== "closed",
  );

  if (alreadyProcessedRun) {
    logCliOutput(
      `Run record for PR ${prNumber} is already ${status}. Skipping DB update.`,
    );
  } else if (targetRun?.id) {
    finishRun(targetRun.id, {
      status: status,
      merge_commit_sha: mergeCommitSha,
      finished_at: mergedAt,
    });
  } else if (status === "merged") {
    warnCli(
      `No matching pending run found for harvest: feature=${featureId}, phase=${phaseId}, PR=${prNumber}. Backfilling run record.`,
    );
    try {
      const featureDir = path.join(projectPath, "specs", featureId);
      const latestManifest = loadManifests(featureDir)
        .filter(
          (m) => m.command === "ship" && (!phaseId || m.phase === phaseId),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

      const backfillId = recordRun({
        feature_id: featureId,
        phase_id: phaseId || latestManifest?.phase || undefined,
        project_id: projectId,
        command: "ship",
        agent_backend: latestManifest?.agent,
        model: latestManifest?.model,
        status: "merged",
        exit_code: latestManifest?.exitCode ?? 0,
        started_at: latestManifest?.startedAt,
        finished_at: mergedAt || latestManifest?.finishedAt,
        duration_s: latestManifest?.durationS,
        attempt: latestManifest?.attempt ?? 1,
        gate_result: latestManifest?.gateResult,
        review_verdict: latestManifest?.reviewVerdict,
        files_changed: latestManifest?.filesChanged,
        lines_added: latestManifest?.linesAdded,
        lines_deleted: latestManifest?.linesDeleted,
        merge_commit_sha: mergeCommitSha,
        pr_number: prNumber || undefined,
        pr_url: record.prUrl || undefined,
        device_id: latestManifest?.deviceId,
        hostname: latestManifest?.hostname,
        tokens_in: latestManifest?.usage?.inputTokens,
        tokens_out: latestManifest?.usage?.outputTokens,
        cost_usd: latestManifest?.usage?.costUsd,
      });
      logCliOutput(
        `Backfilled run record for ${featureId} ${phaseId} (Run ID: ${backfillId})`,
      );
    } catch (dbErr) {
      warnCli(`Failed to backfill run record (non-fatal): ${dbErr}`);
    }
  } else {
    logCliOutput(
      `No pending run found for closed PR ${prNumber}. Skipping backfill.`,
    );
  }

  // If this PR was closed (not merged), we just wanted to clean up the run record and logs.
  // We do not finalize the phase, compute compression, or reconcile gates.
  if (status === "closed") {
    logCliOutput(
      `PR ${prNumber} was closed. Run record updated. Skipping phase finalization.`,
    );
    return;
  }

  // 2.2 Phase Completion Check (FR-H09)
  // If this phase has multiple runs (e.g. parallel dispatch), the merged PR wins.
  // We close any remaining pending runs so they don't block phase finalization forever.
  if (phaseId) {
    const pendingRuns = runs.filter(
      (r) =>
        r.phase_id === phaseId &&
        r.id !== targetRun?.id && // skip the one we just finished
        r.status !== "merged" &&
        r.status !== "closed",
    );

    if (pendingRuns.length > 0) {
      logCliOutput(
        `Phase ${phaseId} has ${pendingRuns.length} other pending runs. Marking them as closed since phase was merged.`,
      );
      for (const r of pendingRuns) {
        if (r.id === undefined) continue;
        try {
          finishRun(r.id, {
            status: "closed",
            finished_at: new Date().toISOString(),
          });
        } catch (e) {
          warnCli(`Failed to close pending run ${r.id}: ${e}`);
        }
      }
    }
  }

  // 2.5 Gate Reconciliation — run gates, persist evidence, update tasks.json
  if (phaseId) {
    try {
      const result = await reconcileGates(projectPath, featureId, phaseId);
      logCliOutput(
        `Gate reconciliation: ${result.passed}/${result.total} passed${result.failed > 0 ? ` (${result.failed} failed)` : ""}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnCli(`Gate reconciliation failed (non-fatal): ${msg}`);
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

        if (targetPhase) {
          const sp = targetPhase.sp ?? 0;
          const config = loadConfig(projectPath);
          const roleMultipliers = resolveRoleMultipliers(config);

          // Use PE as default role if not specified, or TS
          const peRole =
            roleMultipliers.find((r) => r.role === "PE") || roleMultipliers[0];
          const hoursPerSP = peRole?.hoursPerSP || 1.5;
          const overheadFactor = 1.25;
          const estimatedHours = sp * hoursPerSP * overheadFactor;
          const estimatedDays = estimatedHours / 8;

          const forecast: EffortForecast = {
            totalSP: sp,
            roles: [{ role: peRole?.role || "PE", sp }],
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
          let telemetry: CompressionReport["telemetry"];
          try {
            const rawTelemetry = getFeatureRunTelemetry(
              featureId,
              projectId,
              phaseId,
            );
            if (
              rawTelemetry &&
              (rawTelemetry.totalTokens > 0 ||
                rawTelemetry.costUsd > 0 ||
                rawTelemetry.devices.length > 0)
            ) {
              telemetry = computeTelemetryMetrics(forecast, rawTelemetry);
            }
          } catch {
            // Non-fatal if telemetry aggregation or partial mock is unavailable
          }

          report = {
            featureId,
            phaseId,
            generatedAt: new Date().toISOString(),
            forecast,
            actuals,
            compression,
            indicators,
            ...(telemetry ? { telemetry } : {}),
          };

          createSqliteRunStoreAdapter().recordCompression(report, projectId);
          logCliOutput(
            `Recorded compression for ${featureId} ${phaseId}: point=${compression.pointCompression.toFixed(1)}x`,
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnCli(`Failed to calculate compression for ${featureId}: ${msg}`);
    }
  }

  // 4. Slack Done-Done (FR-H07)
  if (report) {
    await notifyDoneDone(report);
  }

  // 5. Branch Cleanup (FR-H08)
  if (status === "merged" && record.headBranch) {
    try {
      await cleanupBranch(record.headBranch, projectPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnCli(
        `Failed to cleanup branch ${record.headBranch} (non-fatal): ${msg}`,
      );
    }
  }

  return report;
}

/**
 * Posts the "🏆 Done, Done!" notification to Slack.
 * (FR-H07)
 */
export async function notifyDoneDone(
  report: CompressionReport,
  notifier?: NotificationPort,
): Promise<void> {
  await notifyHarvestComplete(report, notifier);
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
