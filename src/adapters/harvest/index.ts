/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  finishRun,
  getFeatureRunTelemetry,
  listRuns,
  recordRun,
} from "../../db/runs.js";
import type { CompressionReport, EffortForecast } from "../../domain/types.js";
import {
  computeCompression,
  computeTelemetryMetrics,
  gatherDeliveryActuals,
} from "../../engine/compression.js";
import { computeLeadingIndicators } from "../../engine/indicators.js";
import { reconcileGates } from "../../engine/reconcile-gates.js";
import { resolveRoleMultipliers } from "../../engine/roles.js";
import type { HarvestExecutionPort } from "../../ports/operations-port.js";
import { loadConfig } from "../../utils/config.js";
import { loadManifests } from "../../utils/manifest.js";
import { parsePlan } from "../../utils/parser.js";
import { loadTaskState } from "../../utils/state.js";
import { createSqliteRunStoreAdapter } from "../sqlite/index.js";

export interface HarvestExecutionAdapterOptions {
  db?: Database.Database;
  onCompressionReport?: (report: CompressionReport) => void;
}

export function createHarvestExecutionAdapter(
  options: HarvestExecutionAdapterOptions = {},
): HarvestExecutionPort {
  const { db, onCompressionReport } = options;

  return {
    async discoverPhasesAtCheckout(checkoutDir, featureId) {
      const featureDir = path.join(checkoutDir, "specs", featureId);
      const planPath = path.join(featureDir, "plan.md");
      if (fs.existsSync(planPath)) {
        const parsed = parsePlan(planPath);
        if (parsed.phases.length > 0) {
          return [...new Set(parsed.phases.map((p) => p.id))];
        }
      }
      try {
        const state = loadTaskState(featureDir);
        return [...new Set(state.phases.map((p) => p.id))];
      } catch {
        return [];
      }
    },

    async verifyGatesAtCheckout({
      checkoutDir,
      projectId,
      featureId,
      phaseId,
      updateLocalTaskState,
    }) {
      return reconcileGates(checkoutDir, featureId, phaseId, {
        projectId,
        updateLocalTaskState,
        ...(db ? { db } : {}),
      });
    },

    async recordLearningAtCheckout(input) {
      const {
        checkoutDir,
        projectId,
        featureId,
        phaseId,
        prNumber,
        prUrl,
        terminalEvent,
        mergeCommitSha,
        terminalAt,
        gatePassed,
      } = input;

      const runStatus = terminalEvent === "merged" ? "merged" : "closed";
      const runs = listRuns(featureId, projectId, db);

      const alreadyProcessedRun = runs.find(
        (r) =>
          (phaseId ? r.phase_id === phaseId : !r.phase_id) &&
          (prNumber !== null ? r.pr_number === prNumber : true) &&
          r.status === runStatus,
      );

      const targetRun = runs.find(
        (r) =>
          (phaseId ? r.phase_id === phaseId : !r.phase_id) &&
          (prNumber !== null
            ? r.pr_number === prNumber || !r.pr_number
            : !r.pr_number) &&
          r.status !== "merged" &&
          r.status !== "closed",
      );

      let linkedRunId: number | null = alreadyProcessedRun?.id ?? null;

      if (!alreadyProcessedRun && targetRun?.id !== undefined) {
        finishRun(
          targetRun.id,
          {
            status: runStatus,
            merge_commit_sha: mergeCommitSha ?? undefined,
            finished_at: terminalAt,
            ...(prNumber !== null ? { pr_number: prNumber } : {}),
            ...(prUrl ? { pr_url: prUrl } : {}),
          },
          db,
        );
        linkedRunId = targetRun.id;
      } else if (!alreadyProcessedRun && terminalEvent === "merged") {
        const featureDir = path.join(checkoutDir, "specs", featureId);
        const latestManifest = loadManifests(featureDir)
          .filter(
            (m) => m.command === "ship" && (!phaseId || m.phase === phaseId),
          )
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

        linkedRunId = recordRun(
          {
            feature_id: featureId,
            phase_id: phaseId || latestManifest?.phase || undefined,
            project_id: projectId,
            command: "ship",
            agent_backend: latestManifest?.agent,
            model: latestManifest?.model,
            status: "merged",
            exit_code: latestManifest?.exitCode ?? 0,
            started_at: latestManifest?.startedAt,
            finished_at: terminalAt || latestManifest?.finishedAt,
            duration_s: latestManifest?.durationS,
            attempt: latestManifest?.attempt ?? 1,
            gate_result:
              latestManifest?.gateResult ?? (gatePassed ? "PASS" : "FAIL"),
            review_verdict: latestManifest?.reviewVerdict,
            files_changed: latestManifest?.filesChanged,
            lines_added: latestManifest?.linesAdded,
            lines_deleted: latestManifest?.linesDeleted,
            merge_commit_sha: mergeCommitSha ?? undefined,
            pr_number: prNumber ?? undefined,
            pr_url: prUrl ?? undefined,
            device_id: latestManifest?.deviceId,
            hostname: latestManifest?.hostname,
            tokens_in: latestManifest?.usage?.inputTokens,
            tokens_out: latestManifest?.usage?.outputTokens,
            cost_usd: latestManifest?.usage?.costUsd,
          },
          db,
        );
      }

      if (terminalEvent === "closed_unmerged") {
        return {
          linkedRunId,
          forecastMissing: false,
          summaryText: `PR #${prNumber ?? "unknown"} closed without merge for ${featureId}${phaseId ? ` (${phaseId})` : ""}.`,
        };
      }

      if (phaseId) {
        const siblingPending = runs.filter(
          (r) =>
            r.phase_id === phaseId &&
            r.id !== targetRun?.id &&
            r.status !== "merged" &&
            r.status !== "closed",
        );
        for (const pending of siblingPending) {
          if (pending.id === undefined) continue;
          finishRun(
            pending.id,
            { status: "closed", finished_at: terminalAt },
            db,
          );
        }
      }

      const featureDir = path.join(checkoutDir, "specs", featureId);
      const planPath = path.join(featureDir, "plan.md");
      if (!phaseId || !fs.existsSync(planPath)) {
        return {
          linkedRunId,
          forecastMissing: true,
          summaryText: `Harvest completed for ${featureId}${phaseId ? ` (${phaseId})` : ""} (forecast unavailable).`,
        };
      }

      const parsedPlan = parsePlan(planPath);
      const targetPhase = parsedPlan.phases.find((p) => p.id === phaseId);
      if (!targetPhase) {
        return {
          linkedRunId,
          forecastMissing: true,
          summaryText: `Harvest completed for ${featureId} (${phaseId}) (phase forecast missing).`,
        };
      }

      const sp = targetPhase.sp ?? 0;
      const config = loadConfig(checkoutDir);
      const roleMultipliers = resolveRoleMultipliers(config);
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

      const actuals = gatherDeliveryActuals(featureDir, 30, prNumber ?? 0);
      const compression = computeCompression(forecast, actuals);
      let indicators: CompressionReport["indicators"];
      if (!db) {
        try {
          indicators = computeLeadingIndicators(featureId, forecast, projectId);
        } catch {
          // Non-fatal when leading indicators cannot query the default ledger.
        }
      }

      let telemetry: CompressionReport["telemetry"];
      try {
        const rawTelemetry = getFeatureRunTelemetry(
          featureId,
          projectId,
          phaseId,
          db,
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
        // Non-fatal when telemetry aggregation is unavailable.
      }

      const report: CompressionReport = {
        featureId,
        phaseId,
        generatedAt: terminalAt,
        forecast,
        actuals,
        compression,
        ...(indicators ? { indicators } : {}),
        ...(telemetry ? { telemetry } : {}),
      };

      const runStore = createSqliteRunStoreAdapter(db ? { db } : {});
      runStore.recordCompression(report, projectId);
      onCompressionReport?.(report);

      const { MessageBuilder } = await import("../../server/slack-messages.js");
      const message = MessageBuilder.doneDone(featureId, report);
      return {
        linkedRunId,
        forecastMissing: false,
        pointCompression: compression.pointCompression,
        summaryText: message.text,
        blocks: message.blocks,
      };
    },
  };
}
