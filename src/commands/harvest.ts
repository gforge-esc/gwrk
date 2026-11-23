/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { Command } from "commander";
import {
  logCliOutput,
  setCliExitCode,
  warnCli,
  writeScopedStderr,
} from "../adapters/cli/output-scope.js";
import { createGitVcsAdapter } from "../adapters/git/index.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
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
  type HarvestExecutionSummary,
  createDurableHarvestService,
} from "../application/harvest/index.js";
import { openDatabase } from "../db/index.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import { finalizeLogs } from "../engine/harvest.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  ClockPort,
  GitHubHarvestPort,
  HarvestExecutionPort,
  OperationsStorePort,
} from "../ports/operations-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsPort } from "../ports/vcs-port.js";
import { isRemote } from "../utils/device.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";
import { enrollLocalRepository } from "./project-enroll.js";

export interface HarvestCommandDeps {
  db?: Database.Database;
  store?: OperationsStorePort;
  registry?: ProjectRegistryPort;
  vcs?: VcsPort;
  vcsOverrides?: Partial<VcsPort>;
  github?: GitHubHarvestPort;
  executor?: HarvestExecutionPort;
  notifier?: NotificationPort;
  outbox?: OutboxDeliveryService;
  harvestService?: DurableHarvestService;
  clock?: ClockPort;
}

interface HarvestCliOptions {
  project?: string;
  pr?: string;
  commit?: string;
  format?: string;
  json?: boolean;
  notify?: boolean;
}

function resolveHarvestOutput(options: HarvestCliOptions, command: Command) {
  if (options.json) return createOutput("json");
  if (options.format !== undefined) {
    if (options.format === "text") return createOutput(undefined);
    if (options.format === "json") return createOutput("json");
    throw new CommandError(
      `Unknown format: ${options.format}. Supported: text, json`,
      2,
    );
  }
  try {
    return resolveFormat(command);
  } catch (err) {
    throw new CommandError(err instanceof Error ? err.message : String(err), 2);
  }
}

function parsePositivePrNumber(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new CommandError(
      `Invalid --pr value '${raw}'. Expected a positive integer.`,
      2,
    );
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CommandError(
      `Invalid --pr value '${raw}'. Expected a positive integer.`,
      2,
    );
  }
  return value;
}

function resolveTargetProject(
  registry: ProjectRegistryPort,
  projectSelector?: string,
): { project: EnrolledProject; projectRoot: string } {
  if (projectSelector) {
    const enrolled = registry.getProject(projectSelector);
    if (!enrolled) {
      throw new CommandError(
        `Project '${projectSelector}' is not enrolled. Run 'gwrk project list' to inspect enrollments.`,
        1,
      );
    }
    const projectRoot = enrolled.localRoot ?? enrolled.mirrorPath;
    if (!projectRoot) {
      throw new CommandError(
        `Project '${enrolled.slug}' has no localRoot or mirrorPath configured.`,
        1,
      );
    }
    return { project: enrolled, projectRoot };
  }

  const cwd = process.cwd();
  const canonicalRoot = fs.existsSync(cwd) ? fs.realpathSync(cwd) : cwd;
  const localProjectId = resolveProjectId(canonicalRoot);
  const existing =
    registry.findByLocalRoot(canonicalRoot) ??
    registry.findByLocalRoot(cwd) ??
    registry.getProject(localProjectId);

  if (existing) {
    const projectRoot =
      existing.localRoot ?? existing.mirrorPath ?? canonicalRoot;
    return { project: existing, projectRoot };
  }

  const enrolled = enrollLocalRepository({
    cwd: canonicalRoot,
    registry,
  }).project;
  const projectRoot =
    enrolled.localRoot ?? enrolled.mirrorPath ?? canonicalRoot;
  return { project: enrolled, projectRoot };
}

function hasSummaryFailure(summaries: readonly HarvestExecutionSummary[]): {
  failed: boolean;
  gateFailed: boolean;
} {
  const gateFailed = summaries.some(
    (s) => s.status === "gate_failed" || s.failedStages.includes("gate_verify"),
  );
  const failed = summaries.some(
    (s) =>
      (s.status !== "completed" && s.status !== "closed_unmerged") ||
      s.failedStages.length > 0 ||
      s.pendingStages.length > 0,
  );
  return { failed, gateFailed };
}

/**
 * gwrk harvest <feature> [phase]
 *
 * Manual trigger for the durable harvest pipeline.
 * (FR-002, FR-003, FR-004, FR-005, FR-006)
 */
export const createHarvestCommand = (deps?: HarvestCommandDeps) =>
  new Command("harvest")
    .description("Manually trigger the post-merge harvest pipeline")
    .addHelpText(
      "after",
      `
Type: mutator (reconciles durable harvest state and local gates)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Harvest completed or closed_unmerged recorded
  1: Gate failure, stage error, or project resolution error
  2: Invalid arguments

Examples:
  gwrk harvest 001
  gwrk harvest 001-cli-core 1 --pr 42
  gwrk harvest 001-cli-core phase-01 --project alpha --format json
`,
    )
    .argument("<feature>", "Feature ID (e.g. 011-harvest)")
    .argument("[phase]", "Phase ID (e.g. phase-01 or 1)")
    .option(
      "--project <slug>",
      "Select an enrolled project by slug, ID, repository, or legacy alias",
    )
    .option("--pr <number>", "PR number")
    .option("--commit <sha>", "Merge commit SHA")
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output harvest receipt as JSON")
    .option("--no-notify", "Suppress Slack delivery notifications")
    .action(
      async (
        featureArg: string,
        phase: string | undefined,
        options: HarvestCliOptions,
        command: Command,
      ) => {
        await withSignal(`harvest ${featureArg}`, async () => {
          const out = resolveHarvestOutput(options, command);
          const prNumber = parsePositivePrNumber(options.pr);

          if (isRemote()) {
            throw new CommandError(
              "This machine is registered as a remote device. Harvest runs on the server only.\n" +
                "To change this machine's role: gwrk init --server",
              1,
            );
          }

          let phaseId = phase;
          if (phase?.match(/^\d+$/)) {
            phaseId = `phase-${phase.padStart(2, "0")}`;
          }

          let ownedDb: Database.Database | undefined;
          let db: Database.Database | undefined = deps?.db;
          if (!db && (!deps?.store || !deps?.registry)) {
            ownedDb = openDatabase();
            db = ownedDb;
          }
          try {
            const registry =
              deps?.registry ??
              createSqliteProjectRegistryAdapter(db ? { db } : {});
            const store =
              deps?.store ??
              createSqliteOperationsStoreAdapter(db ? { db } : {});
            const { project, projectRoot } = resolveTargetProject(
              registry,
              options.project,
            );
            const feature = resolveFeature(featureArg, projectRoot);

            const clock: ClockPort = deps?.clock ?? {
              nowIso: () => new Date().toISOString(),
              nowMs: () => Date.now(),
            };
            const baseVcs = deps?.vcs ?? createGitVcsAdapter();
            const vcs: VcsPort = deps?.vcsOverrides
              ? { ...baseVcs, ...deps.vcsOverrides }
              : baseVcs;
            const github = deps?.github ?? createGitHubHarvestAdapter();
            const executor =
              deps?.executor ?? createHarvestExecutionAdapter(db ? { db } : {});
            const notifier =
              deps?.notifier ??
              createSlackNotificationAdapter({
                registry,
                projectRoot,
                transportTimeoutMs: 5_000,
              });
            const outbox =
              deps?.outbox ??
              createOutboxDeliveryService({
                store,
                registry,
                notifier,
                clock,
                newId: () => randomUUID(),
              });
            const service =
              deps?.harvestService ??
              createDurableHarvestService({
                store,
                registry,
                vcs,
                github,
                executor,
                outbox,
                clock,
                heartbeatIntervalMs: null,
              });

            const recipient = options.notify === false ? null : undefined;
            if (!out.isJson) {
              logCliOutput(
                `Triggering durable harvest for ${project.slug}:${feature}${phaseId ? ` (${phaseId})` : ""}...`,
              );
            }

            const summaries = await service.runManualHarvest({
              project,
              featureId: feature,
              ...(phaseId ? { phaseId } : {}),
              ...(prNumber !== undefined ? { prNumber } : {}),
              ...(options.commit ? { commitSha: options.commit } : {}),
              ...(recipient !== undefined ? { recipient } : {}),
              updateLocalTaskState: true,
              ownerId: `cli:${process.pid}`,
            });

            const { failed, gateFailed } = hasSummaryFailure(summaries);

            if (!failed) {
              const runsDir = path.join(
                projectRoot,
                "specs",
                feature,
                ".gwrk",
                "runs",
              );
              if (
                fs.existsSync(runsDir) &&
                fs.readdirSync(runsDir).some((f) => f.endsWith(".log"))
              ) {
                try {
                  await finalizeLogs(feature, projectRoot);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  warnCli(`Log finalization failed (non-fatal): ${msg}`);
                }
              }
            }

            const recoveryCmd = `gwrk harvest ${feature}${phaseId ? ` ${phaseId}` : ""}${options.project ? ` --project ${project.slug}` : ""}${prNumber !== undefined ? ` --pr ${prNumber}` : ""}${options.commit ? ` --commit ${options.commit}` : ""}`;

            if (out.isJson) {
              out.write({
                ok: !failed,
                projectId: project.projectId,
                projectSlug: project.slug,
                featureId: feature,
                phaseId: phaseId ?? null,
                prNumber: prNumber ?? null,
                commitSha: options.commit ?? null,
                operations: summaries,
              });
              if (failed) {
                writeScopedStderr(
                  gateFailed
                    ? `hint: Gate verification failed. Fix failing gates and re-run '${recoveryCmd}', or inspect 'gwrk status --project ${project.slug}'.\n`
                    : `hint: Harvest has unresolved stages. Inspect 'gwrk status --project ${project.slug}' and re-run '${recoveryCmd}'.\n`,
                );
                setCliExitCode(1);
              }
              return;
            }

            for (const summary of summaries) {
              const details = [
                `status=${summary.status}`,
                `operationId=${summary.operationId}`,
                ...(summary.linkedRunId !== null
                  ? [`runId=${summary.linkedRunId}`]
                  : []),
                ...(summary.deduplicatedWork ? ["deduplicated=true"] : []),
                ...(summary.pendingStages.length > 0
                  ? [`pending=[${summary.pendingStages.join(",")}]`]
                  : []),
                ...(summary.failedStages.length > 0
                  ? [`failed=[${summary.failedStages.join(",")}]`]
                  : []),
              ];
              logCliOutput(`  ${summary.workKey}: ${details.join(" ")}`);
            }

            if (failed) {
              writeScopedStderr(
                gateFailed
                  ? `hint: Gate verification failed. Fix failing gates and re-run '${recoveryCmd}', or inspect 'gwrk status --project ${project.slug}'.\n`
                  : `hint: Harvest has unresolved stages. Inspect 'gwrk status --project ${project.slug}' and re-run '${recoveryCmd}'.\n`,
              );
              setCliExitCode(1);
              return;
            }

            logCliOutput("Harvest complete.");
          } finally {
            if (ownedDb?.open) ownedDb.close();
          }
        });
      },
    );

export const harvestCommand = createHarvestCommand();
