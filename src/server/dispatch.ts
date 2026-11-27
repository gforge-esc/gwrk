/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { logCliError } from "../adapters/cli/output-scope.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { createGitHubHarvestAdapter } from "../adapters/github/index.js";
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
  type DurableDispatchService,
  type DurableDispatchServiceDeps,
  createDurableDispatchService,
} from "../application/dispatch/index.js";
import { finishRun, startRun } from "../db/runs.js";
import type {
  DispatchReceipt,
  DurableDispatchOperation,
  WorkerRecoveryEvidence,
} from "../domain/durable-dispatch.js";
import type {
  DeliveryRecipient,
  EnrolledProject,
} from "../domain/project-registry.js";
import { resolveProjectSlackRecipient } from "../domain/slack-delivery.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type {
  ClockPort,
  GitHubHarvestPort,
  OperationsStorePort,
  WorkerExecutionPort,
} from "../ports/operations-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { AgentBackendId, GwrkConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";
import { pillarBackend } from "../utils/resolve-agent.js";
import type { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import { SandboxManager } from "./sandbox.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";
import type {
  DispatchAttempt,
  DispatchRecord,
  DispatchRequest,
  DispatchStatus,
  TaskRecord,
} from "./types.js";

export class DispatchIntakeError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "DispatchIntakeError";
  }
}

export type { DispatchRequest } from "./types.js";

export type DeferDispatchDrain = boolean | ((release: () => void) => void);

export interface DispatchLedgerScope {
  db: Database.Database;
  projectId: string;
}

export interface DurableDispatchQueueOptions {
  store?: OperationsStorePort;
  registry?: ProjectRegistryPort;
  worker?: WorkerExecutionPort;
  outbox?: OutboxDeliveryService;
  notifier?: NotificationPort;
  clock?: ClockPort;
  github?: GitHubHarvestPort;
  ownerId?: string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number | null;
  maxCrashRecoveryAttempts?: number;
  onRecoveredMerge?: DurableDispatchServiceDeps["onRecoveredMerge"];
}

function mapOperationStatus(
  status: DurableDispatchOperation["status"],
): DispatchStatus {
  switch (status) {
    case "accepted":
      return "queued";
    case "leased":
    case "running":
    case "reconciling":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "superseded":
      return "failed";
  }
}

function operationToRecord(
  op: DurableDispatchOperation,
  project?: EnrolledProject,
): DispatchRecord {
  const status = mapOperationStatus(op.status);
  return {
    id: op.operationId,
    operationId: op.operationId,
    projectId: op.projectId,
    workKey: op.workKey,
    projectRoot: project?.mirrorPath ?? project?.localRoot ?? "",
    trunkBranch: op.trunkBranch,
    featureId: op.featureId,
    phaseId: op.phaseId,
    backend: op.backend as AgentBackendId,
    status,
    branchName: op.branchName,
    attempts: [],
    attemptCount: op.attemptCount,
    recipient: op.recipient,
    tasks: op.taskIds.map((id) => ({
      id,
      status:
        status === "completed"
          ? "completed"
          : status === "failed"
            ? "failed"
            : status === "running"
              ? "running"
              : "pending",
      sandboxDir: "",
      backend: op.backend as AgentBackendId,
    })),
    createdAt: op.createdAt,
    ...(op.completedAt ? { completedAt: op.completedAt } : {}),
    ...(op.prNumber !== null ? { prNumber: op.prNumber } : {}),
    ...(op.prUrl !== null ? { prUrl: op.prUrl } : {}),
  };
}

function findWorktreeForBranch(
  projectRoot: string,
  branchName: string,
  env?: NodeJS.ProcessEnv,
): { found: boolean; worktreeDir: string | null } {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: projectRoot,
    ...(env ? { env } : {}),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  });
  const targetRef = `refs/heads/${branchName}`;
  for (const block of output.split("\n\n")) {
    let wtPath = "";
    let wtBranch = "";
    for (const line of block.trim().split("\n")) {
      if (line.startsWith("worktree ")) wtPath = line.slice(9).trim();
      if (line.startsWith("branch ")) wtBranch = line.slice(7).trim();
    }
    if (wtPath && wtBranch === targetRef) {
      return { found: true, worktreeDir: wtPath };
    }
  }
  return { found: false, worktreeDir: null };
}

/**
 * DispatchQueue — the daemon's entry point into the unified ship engine.
 *
 * A dispatch is a **feature-phase** scoped to an enrolled project: the queue
 * isolates it in a git worktree branched from the project's enrolled trunk
 * branch and drives the SAME `ShipOrchestrator` the CLI (`gwrk ship`) uses.
 */
export class DispatchQueue {
  private queue: DispatchRecord[] = [];
  private active: DispatchRecord[] = [];
  private history: DispatchRecord[] = [];
  private paused = false;
  private closed = false;
  private readonly notificationShutdown = new AbortController();
  private inFlight = new Set<Promise<void>>();
  private errors: unknown[] = [];
  private readonly ownerId: string;
  private readonly clock: ClockPort;
  private readonly durableStore?: OperationsStorePort;
  private readonly durableRegistry?: ProjectRegistryPort;
  private readonly durableOutbox?: OutboxDeliveryService;
  private readonly durableService?: DurableDispatchService;
  private readonly activeDurableOps = new Map<
    string,
    DurableDispatchOperation
  >();
  private readonly completedDurableIds = new Map<string, string | undefined>();
  private readonly failedDurableIds = new Map<string, string | undefined>();
  private startupRecovered = false;
  private recoveryPromise: Promise<{
    requeuedCount: number;
    completedFromPrCount: number;
    failedCount: number;
  }> | null = null;
  private scheduledDrain?: NodeJS.Immediate;
  private readonly awaitingAcknowledgment = new Set<string>();
  private readonly suppliedRegistry?: ProjectRegistryPort;

  private get registry(): ProjectRegistryPort | undefined {
    return (
      this.suppliedRegistry ??
      (this.durableRegistry?.listProjects().length
        ? this.durableRegistry
        : undefined)
    );
  }

  constructor(
    private config: GwrkConfig,
    private monitor: SystemMonitor,
    private sandbox: SandboxManager,
    private projectRoot: string,
    private ledger?: DispatchLedgerScope,
    private gitEnv?: () => NodeJS.ProcessEnv,
    private readonly approvedBackend?: AgentBackendId,
    registryOrDurableOptions?:
      | ProjectRegistryPort
      | DurableDispatchQueueOptions,
    appendedDurableOptions?: DurableDispatchQueueOptions,
  ) {
    const registryOnly =
      registryOrDurableOptions !== undefined &&
      "getProject" in registryOrDurableOptions;
    const durableOptions = registryOnly
      ? appendedDurableOptions
      : (registryOrDurableOptions ?? appendedDurableOptions);
    const suppliedRegistry = registryOnly
      ? registryOrDurableOptions
      : durableOptions?.registry;
    this.suppliedRegistry = suppliedRegistry;
    this.ownerId =
      durableOptions?.ownerId ??
      `daemon:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.clock = durableOptions?.clock ?? {
      nowIso: () => new Date().toISOString(),
      nowMs: () => Date.now(),
    };

    const db = ledger?.db;
    const rawStore =
      durableOptions?.store ??
      (db ? createSqliteOperationsStoreAdapter({ db }) : undefined);
    const registry =
      suppliedRegistry ??
      (db ? createSqliteProjectRegistryAdapter({ db }) : undefined);
    if (rawStore && registry) {
      const notifier =
        durableOptions?.notifier ??
        createSlackNotificationAdapter({
          projectRoot,
          registry,
          signal: this.notificationShutdown.signal,
          transportTimeoutMs: 5_000,
        });
      const outbox =
        durableOptions?.outbox ??
        createOutboxDeliveryService({
          store: rawStore,
          registry,
          notifier,
          clock: this.clock,
          newId: () => crypto.randomUUID(),
        });
      const worker =
        durableOptions?.worker ??
        this.createDefaultWorkerPort(durableOptions?.github);

      const fencedStore: OperationsStorePort = {
        ...rawStore,
        claimDispatchLease: (input) => {
          // Recovery can reconcile a lease while paused. Only gate new workers here.
          if (
            input.expectedLeaseEpoch === undefined &&
            (this.paused ||
              this.closed ||
              !this.hasWorkerCapacity() ||
              this.awaitingAcknowledgment.has(input.operationId))
          ) {
            return null;
          }
          const claimed = rawStore.claimDispatchLease(input);
          if (claimed) {
            this.activeDurableOps.set(
              claimed.operation.operationId,
              claimed.operation,
            );
          }
          return claimed;
        },
        completeDispatchAttempt: (input) => {
          const prior = this.activeDurableOps.get(input.fence.operationId);
          const result = rawStore.completeDispatchAttempt(input);
          if (result.ok || prior?.leaseEpoch === input.fence.leaseEpoch) {
            this.activeDurableOps.delete(input.fence.operationId);
            this.scheduleDrain();
          }
          if (result.ok) {
            if (input.operationStatus === "completed") {
              this.completedDurableIds.set(
                input.fence.operationId,
                prior?.projectId,
              );
            } else if (input.operationStatus === "failed") {
              this.failedDurableIds.set(
                input.fence.operationId,
                prior?.projectId,
              );
            }
            if (
              prior &&
              (input.operationStatus === "completed" ||
                input.operationStatus === "failed")
            ) {
              this.enqueueDurableOutcomeNotification(prior, {
                operationStatus: input.operationStatus,
                prNumber: input.prNumber,
                prUrl: input.prUrl,
                error: input.error,
              });
            }
          }
          return result;
        },
      };

      this.durableStore = rawStore;
      this.durableRegistry = registry;
      this.durableOutbox = outbox;
      this.durableService = createDurableDispatchService({
        store: fencedStore,
        registry,
        worker,
        clock: this.clock,
        leaseDurationMs: durableOptions?.leaseDurationMs,
        heartbeatIntervalMs: durableOptions?.heartbeatIntervalMs,
        maxCrashRecoveryAttempts: durableOptions?.maxCrashRecoveryAttempts,
        onRecoveredMerge: durableOptions?.onRecoveredMerge,
      });
    }
  }

  private resolveProjectGitEnv(
    targetRoot: string,
  ): NodeJS.ProcessEnv | undefined {
    if (resolve(targetRoot) === resolve(this.projectRoot)) {
      return this.gitEnv?.();
    }
    return repositoryGitEnv(targetRoot);
  }

  private resolveProjectSandbox(targetRoot: string): SandboxManager {
    if (resolve(targetRoot) === resolve(this.projectRoot)) {
      return this.sandbox;
    }
    return new SandboxManager(targetRoot, () => repositoryGitEnv(targetRoot));
  }

  private createDefaultWorkerPort(
    injectedGithub?: GitHubHarvestPort,
  ): WorkerExecutionPort {
    const github = injectedGithub ?? createGitHubHarvestAdapter();
    return {
      inspectRecoveredWork: async (input): Promise<WorkerRecoveryEvidence> => {
        const isLocallyActive = this.activeDurableOps.has(input.operationId);
        let workerState: WorkerRecoveryEvidence["workerState"] = isLocallyActive
          ? "running"
          : "stopped";
        let sandboxDir: string | null = null;
        if (!isLocallyActive) {
          try {
            const wt = findWorktreeForBranch(
              input.projectRoot,
              input.branchName,
              this.resolveProjectGitEnv(input.projectRoot),
            );
            sandboxDir = wt.worktreeDir;
          } catch {
            workerState = "unknown";
            sandboxDir = null;
          }
        }

        if (!input.repoSlug) {
          return {
            workerState,
            pullRequestLookup: "complete",
            openPullRequest: null,
            mergedPullRequest: null,
            completedManifestRunId: null,
            sandboxDir,
          };
        }

        try {
          const expectedRepoSlug = input.repoSlug.toLowerCase();
          if (input.persistedPullRequest) {
            const fact = await github.getPullRequest({
              cwd: input.projectRoot,
              repoSlug: input.repoSlug,
              prNumber: input.persistedPullRequest.prNumber,
            });
            if (fact && fact.repoSlug.toLowerCase() === expectedRepoSlug) {
              if (fact.merged && fact.mergeCommitSha) {
                return {
                  workerState,
                  pullRequestLookup: "complete",
                  openPullRequest: null,
                  mergedPullRequest: {
                    operationId: input.operationId,
                    prNumber: fact.prNumber,
                    prUrl: fact.prUrl,
                    mergeCommitSha: fact.mergeCommitSha,
                  },
                  completedManifestRunId: null,
                  sandboxDir,
                };
              }
              if (fact.state === "OPEN") {
                return {
                  workerState,
                  pullRequestLookup: "complete",
                  openPullRequest: {
                    operationId: input.operationId,
                    prNumber: fact.prNumber,
                    prUrl: fact.prUrl,
                  },
                  mergedPullRequest: null,
                  completedManifestRunId: null,
                  sandboxDir,
                };
              }
            }
            return {
              workerState,
              pullRequestLookup: "complete",
              openPullRequest: null,
              mergedPullRequest: null,
              completedManifestRunId: null,
              sandboxDir,
            };
          }

          const enrolledForRepo =
            this.durableRegistry?.findByRepoSlug(input.repoSlug) ??
            this.durableRegistry?.findByLocalRoot(input.projectRoot);
          const baseBranch = enrolledForRepo?.trunkBranch ?? "develop";
          const terminalPrs = await github.listTerminalPullRequests({
            cwd: input.projectRoot,
            repoSlug: input.repoSlug,
            baseBranch,
          });
          const matchedMerged = terminalPrs.find(
            (pr) =>
              pr.merged &&
              pr.mergeCommitSha &&
              pr.repoSlug.toLowerCase() === expectedRepoSlug &&
              pr.headRepoSlug?.toLowerCase() === expectedRepoSlug &&
              pr.headBranch === input.branchName,
          );
          if (matchedMerged?.mergeCommitSha) {
            return {
              workerState,
              pullRequestLookup: "complete",
              openPullRequest: null,
              mergedPullRequest: {
                operationId: input.operationId,
                prNumber: matchedMerged.prNumber,
                prUrl: matchedMerged.prUrl,
                mergeCommitSha: matchedMerged.mergeCommitSha,
              },
              completedManifestRunId: null,
              sandboxDir,
            };
          }

          const openPrs = github.listOpenPullRequests
            ? await github.listOpenPullRequests({
                cwd: input.projectRoot,
                repoSlug: input.repoSlug,
                baseBranch,
                headBranch: input.branchName,
              })
            : [];
          const matchedOpen = openPrs.find(
            (pr) =>
              pr.state === "OPEN" &&
              pr.repoSlug.toLowerCase() === expectedRepoSlug &&
              pr.headRepoSlug?.toLowerCase() === expectedRepoSlug &&
              pr.headBranch === input.branchName,
          );
          if (matchedOpen) {
            return {
              workerState,
              pullRequestLookup: "complete",
              openPullRequest: {
                operationId: input.operationId,
                prNumber: matchedOpen.prNumber,
                prUrl: matchedOpen.prUrl,
              },
              mergedPullRequest: null,
              completedManifestRunId: null,
              sandboxDir,
            };
          }

          return {
            workerState,
            pullRequestLookup: "complete",
            openPullRequest: null,
            mergedPullRequest: null,
            completedManifestRunId: null,
            sandboxDir,
          };
        } catch {
          return {
            workerState: isLocallyActive ? "running" : "unknown",
            pullRequestLookup: "unavailable",
            openPullRequest: null,
            mergedPullRequest: null,
            completedManifestRunId: null,
            sandboxDir,
          };
        }
      },

      launchPhaseShip: async (input) => {
        const startedAtMs = this.clock.nowMs();
        const activeOp = [...this.activeDurableOps.values()].find(
          (op) => op.branchName === input.branchName,
        );
        const runProjectId =
          activeOp?.projectId ??
          this.durableRegistry?.findByLocalRoot(input.projectRoot)?.projectId ??
          this.ledger?.projectId;
        const runId = startRun(
          {
            feature_id: input.featureId,
            phase_id: input.phaseId,
            command: `gwrk ship ${input.featureId} ${input.phaseId}`,
            agent_backend: input.backend,
            workflow: "work-until-done",
            project_id: runProjectId,
          },
          this.ledger?.db,
        );

        const projectSandbox = this.resolveProjectSandbox(input.projectRoot);
        const projectGitEnv = this.resolveProjectGitEnv(input.projectRoot);
        let worktreeDir: string | undefined;
        let exitCode = 1;
        let stderr = "";
        let prNumber: number | undefined;
        let prUrl: string | undefined;

        try {
          worktreeDir = await projectSandbox.createSandbox({
            featureId: input.featureId,
            phaseId: input.phaseId,
            taskId: "ship",
            backend: input.backend as AgentBackendId,
            projectRoot: input.projectRoot,
            baseBranch: input.trunkBranch,
            branchName: input.branchName,
            setup: this.config.worktree?.setup,
          });

          const orchestrator = new ShipOrchestrator({
            featureId: input.featureId,
            phaseId: input.phaseId,
            backend: input.backend as AgentBackendId,
            maxIterations: 3,
            ciTimeout: 30,
            cwd: worktreeDir,
            gitEnv: projectGitEnv,
            stateRoot: input.projectRoot,
            branchName: input.branchName,
          });

          exitCode = await orchestrator.run();
          const result = orchestrator.getResult();
          if (result.prNumber) prNumber = result.prNumber;
          if (result.prUrl) prUrl = result.prUrl;
          stderr =
            exitCode === 0
              ? ""
              : `ShipOrchestrator exited with code ${exitCode}`;
        } catch (error) {
          exitCode = 1;
          stderr = error instanceof Error ? error.message : String(error);
        } finally {
          const duration = Math.max(
            0,
            Math.floor((this.clock.nowMs() - startedAtMs) / 1000),
          );
          try {
            finishRun(
              runId,
              { exit_code: exitCode, duration_s: duration },
              this.ledger?.db,
            );
          } catch (error) {
            this.errors.push(error);
          }
          if (worktreeDir) {
            try {
              await projectSandbox.destroySandbox(
                worktreeDir,
                input.featureId,
                {
                  autoCommitPush: false,
                },
              );
            } catch (error) {
              this.errors.push(error);
              logCliError("Failed to destroy sandbox:", error);
            }
          }
        }

        return {
          exitCode,
          stderr,
          workDir: worktreeDir,
          prNumber,
          prUrl,
          runId,
        };
      },

      cleanupStaleSandbox: async (projectRoot, workDir, featureId) => {
        const projectSandbox = this.resolveProjectSandbox(projectRoot);
        await projectSandbox.destroySandbox(workDir, featureId, {
          autoCommitPush: false,
        });
      },
    };
  }

  private deriveDurableSlackDestination(
    project: EnrolledProject,
    featureId: string,
    recipient: DeliveryRecipient | null,
  ): DeliveryRecipient | null {
    if (!project.slack || !this.durableRegistry) return null;
    const thread = this.durableRegistry.getFeatureThread(
      project.projectId,
      featureId,
    );
    const storedThread =
      thread?.projectId === project.projectId && thread.featureId === featureId
        ? thread
        : null;
    const resolved = resolveProjectSlackRecipient({
      project,
      enrolledProjects: this.durableRegistry.listProjects(),
      storedThread,
      recipient: recipient ?? undefined,
      opsOnly: Boolean(recipient?.opsOnly),
    });
    return resolved.ok ? (resolved.recipient ?? null) : null;
  }

  private enqueueDurableOutcomeNotification(
    operation: DurableDispatchOperation,
    completion: {
      operationStatus: "completed" | "failed";
      prNumber?: number;
      prUrl?: string;
      error?: string;
    },
  ): void {
    if (!this.durableOutbox || !this.durableRegistry) return;
    const project = this.durableRegistry.getProject(operation.projectId);
    if (!project) return;
    const slackDestination = this.deriveDurableSlackDestination(
      project,
      operation.featureId,
      operation.recipient,
    );
    if (!slackDestination) return;

    const reviewReady = completion.operationStatus === "completed";
    const eventType = reviewReady ? "review_ready" : "phase_fail";
    const record: DispatchRecord = {
      ...operationToRecord(
        operation,
        this.durableRegistry?.getProject(operation.projectId) ?? undefined,
      ),
      status: reviewReady ? "completed" : "failed",
      ...(completion.prNumber !== undefined
        ? { prNumber: completion.prNumber }
        : {}),
      ...(completion.prUrl !== undefined ? { prUrl: completion.prUrl } : {}),
    };
    const message = reviewReady
      ? MessageBuilder.reviewReady({
          ...record,
          projectSlug: project.slug,
          rootTs: slackDestination.threadTs,
        })
      : MessageBuilder.phaseFail(
          {
            ...record,
            projectSlug: project.slug,
            rootTs: slackDestination.threadTs,
          },
          completion.error ?? "Dispatch failed",
        );

    const outboxId = this.durableOutbox.enqueueProjectNotification({
      project,
      dedupeKey: JSON.stringify([
        "dispatch_outcome",
        operation.operationId,
        eventType,
      ]),
      ownerKind: "dispatch",
      ownerOperationId: operation.operationId,
      eventType,
      featureId: operation.featureId,
      phaseId: operation.phaseId,
      recipient: slackDestination,
      message: {
        text: message.text,
        blocks: message.blocks,
      },
    });

    if (this.closed) return;

    const flushWork = this.durableOutbox
      .flushOutboxItem(outboxId)
      .then(() => undefined)
      .catch((error: unknown) => {
        logCliError("Failed to flush durable dispatch notification:", error);
      })
      .finally(() => this.inFlight.delete(flushWork));
    this.inFlight.add(flushWork);
  }

  private resolveEnrolledProject(
    request: Pick<DispatchRequest, "projectId">,
  ): EnrolledProject | null {
    if (!this.durableRegistry) {
      if (request.projectId) {
        throw new DispatchIntakeError(
          404,
          `Project is not enrolled: ${request.projectId}`,
        );
      }
      return null;
    }
    if (request.projectId) {
      const enrolled = this.durableRegistry.getProject(request.projectId);
      if (!enrolled) {
        throw new DispatchIntakeError(
          404,
          `Project is not enrolled: ${request.projectId}`,
        );
      }
      return enrolled;
    }
    return (
      this.durableRegistry.findByLocalRoot(this.projectRoot) ??
      (this.ledger?.projectId
        ? this.durableRegistry.getProject(this.ledger.projectId)
        : null)
    );
  }

  runInTransaction<T>(fn: () => T): T {
    if (this.ledger?.db) {
      return this.ledger.db.transaction(fn).immediate();
    }
    return fn();
  }

  getRegistry(): ProjectRegistryPort | undefined {
    return this.registry;
  }

  supportsMultiProjectDispatch(): boolean {
    return Boolean(this.durableService);
  }

  isSharedMultiProjectQueue(): boolean {
    return (
      this.supportsMultiProjectDispatch() &&
      (this.registry?.listProjects().length ?? 0) > 1
    );
  }

  accept(
    request: DispatchRequest,
    options?: {
      deferDrain?: DeferDispatchDrain;
      defaultRecipientSurface?: "http" | "local_cli";
    },
  ): DispatchReceipt | null {
    if (this.closed) throw new Error("Dispatch queue is closed");
    if (!this.durableService) {
      if (request.projectId && !this.registry) {
        throw new DispatchIntakeError(
          404,
          `Project is not enrolled: ${request.projectId}`,
        );
      }
      return null;
    }
    const context = this.resolveProjectContext(request);
    const project = this.resolveEnrolledProject({
      projectId:
        request.projectId || request.recipient?.projectId
          ? context.projectId
          : undefined,
    });
    if (!project) return null;

    const backend =
      this.approvedBackend ??
      pillarBackend(this.config, "implement", request.backend);
    const taskIds = request.taskIds
      ? [...request.taskIds]
      : request.taskId
        ? [request.taskId]
        : undefined;
    const recipient: DeliveryRecipient | null =
      request.recipient !== undefined
        ? request.recipient === null
          ? null
          : (context.recipient ?? request.recipient)
        : options?.defaultRecipientSurface
          ? {
              projectId: project.projectId,
              surface: options.defaultRecipientSurface,
            }
          : null;

    let receipt: DispatchReceipt;
    try {
      receipt = this.durableService.accept({
        project,
        featureId: request.featureId,
        phaseId: request.phaseId,
        taskIds,
        backend,
        recipient,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("belongs to another project")
      ) {
        throw new DispatchIntakeError(400, error.message);
      }
      throw error;
    }

    if (typeof options?.deferDrain === "function") {
      const { operationId } = receipt;
      if (!receipt.deduplicated) this.awaitingAcknowledgment.add(operationId);
      options.deferDrain(() => {
        this.awaitingAcknowledgment.delete(operationId);
        this.scheduleDrain();
      });
    } else if (!options?.deferDrain) {
      this.scheduleDrain();
    }
    return receipt;
  }

  async recoverOnStartup(): Promise<{
    requeuedCount: number;
    completedFromPrCount: number;
    failedCount: number;
  }> {
    if (!this.durableService) {
      this.startupRecovered = true;
      return { requeuedCount: 0, completedFromPrCount: 0, failedCount: 0 };
    }
    if (!this.recoveryPromise) {
      const work = this.durableService
        .recoverOnStartup(this.ownerId)
        .then((summary) => {
          this.startupRecovered = true;
          return summary;
        })
        .finally(() => {
          this.recoveryPromise = null;
        });
      this.recoveryPromise = work;
    }
    const result = await this.recoveryPromise;
    if (!this.paused && !this.closed) {
      this.processNext();
    }
    return result;
  }

  getOperation(
    projectId: string,
    featureId: string,
    phaseId: string,
  ): DurableDispatchOperation | null {
    return (
      this.durableService?.getOperation(projectId, featureId, phaseId) ?? null
    );
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (this.closed) return;
    this.paused = false;
    this.processNext();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearImmediate(this.scheduledDrain);
    this.scheduledDrain = undefined;
    this.pause();
    this.notificationShutdown.abort();
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
    if (this.errors.length === 1) throw this.errors[0];
    if (this.errors.length > 1)
      throw new AggregateError(this.errors, "Dispatch queue failed");
  }

  /** Ship branch for a feature-phase. Per-phase (`feat/<feature>-phase-NN`) so
   * concurrent phases of one feature never collide on a branch/worktree, and so
   * harvest's branch parser (`parseFeatureBranch`) recovers feature + phase. */
  private shipBranch(featureId: string, phaseId: string): string {
    return `feat/${featureId}-${phaseId}`;
  }

  private resolveProjectContext(request: DispatchRequest): {
    projectId: string;
    projectRoot: string;
    trunkBranch: string;
    recipient?: DeliveryRecipient;
  } {
    if (this.registry) {
      const requestedProject = request.projectId
        ? this.registry.getProject(request.projectId)
        : null;
      if (request.projectId && !requestedProject) {
        throw new DispatchIntakeError(
          404,
          `Project is not enrolled: ${request.projectId}`,
        );
      }

      const recipientProject = request.recipient?.projectId
        ? this.registry.getProject(request.recipient.projectId)
        : null;
      if (request.recipient?.projectId && !recipientProject) {
        throw new DispatchIntakeError(
          400,
          `Recipient project is not enrolled: ${request.recipient.projectId}`,
        );
      }

      if (
        requestedProject &&
        recipientProject &&
        requestedProject.projectId !== recipientProject.projectId
      ) {
        throw new DispatchIntakeError(
          400,
          `Conflicting dispatch projectId (${requestedProject.projectId}) and recipient.projectId (${recipientProject.projectId})`,
        );
      }

      const enrolled =
        requestedProject ??
        recipientProject ??
        this.registry.findByLocalRoot(this.projectRoot) ??
        null;

      if (enrolled && request.recipient) {
        const storedThread = !request.recipient.opsOnly
          ? this.registry.getFeatureThread(
              enrolled.projectId,
              request.featureId,
            )
          : null;
        const recipientCheck = resolveProjectSlackRecipient({
          project: enrolled,
          enrolledProjects: this.registry.listProjects(),
          storedThread,
          recipient: request.recipient,
          opsOnly: Boolean(request.recipient.opsOnly),
        });
        if (!recipientCheck.ok) {
          throw new DispatchIntakeError(403, recipientCheck.message);
        }
      }

      const projectId =
        enrolled?.projectId ??
        this.ledger?.projectId ??
        resolveProjectId(this.projectRoot);
      const projectRoot =
        enrolled?.mirrorPath ?? enrolled?.localRoot ?? this.projectRoot;
      const trunkBranch = enrolled?.trunkBranch ?? "develop";
      const recipient = request.recipient
        ? { ...request.recipient, projectId }
        : undefined;

      return { projectId, projectRoot, trunkBranch, recipient };
    }

    if (
      request.projectId &&
      request.recipient?.projectId &&
      request.projectId !== request.recipient.projectId
    ) {
      throw new DispatchIntakeError(
        400,
        `Conflicting dispatch projectId (${request.projectId}) and recipient.projectId (${request.recipient.projectId})`,
      );
    }

    const projectId =
      request.projectId ??
      request.recipient?.projectId ??
      this.ledger?.projectId ??
      resolveProjectId(this.projectRoot);
    const recipient = request.recipient
      ? { ...request.recipient, projectId }
      : undefined;

    return {
      projectId,
      projectRoot: this.projectRoot,
      trunkBranch: "develop",
      recipient,
    };
  }

  private matchesProject(record: DispatchRecord, projectId?: string): boolean {
    if (!projectId) return true;
    const resolvedId =
      this.registry?.getProject(projectId)?.projectId ?? projectId;
    return record.projectId === projectId || record.projectId === resolvedId;
  }

  enqueue(request: DispatchRequest): DispatchRecord {
    if (this.closed) throw new Error("Dispatch queue is closed");
    const { projectId, projectRoot, trunkBranch, recipient } =
      this.resolveProjectContext(request);

    const durableReceipt = this.accept(request);
    if (durableReceipt) {
      const op = this.durableService?.getOperation(
        durableReceipt.projectId,
        durableReceipt.featureId,
        durableReceipt.phaseId,
      );
      const record = op
        ? operationToRecord(
            op,
            this.durableRegistry?.getProject(op.projectId) ?? undefined,
          )
        : {
            id: durableReceipt.operationId,
            operationId: durableReceipt.operationId,
            projectId: durableReceipt.projectId,
            workKey: durableReceipt.workKey,
            featureId: durableReceipt.featureId,
            phaseId: durableReceipt.phaseId,
            backend:
              this.approvedBackend ??
              pillarBackend(this.config, "implement", request.backend),
            status: mapOperationStatus(durableReceipt.status),
            branchName: durableReceipt.branchName,
            projectRoot,
            trunkBranch,
            attempts: [],
            attemptCount: durableReceipt.attemptCount,
            recipient: durableReceipt.recipient,
            tasks: [],
            createdAt: durableReceipt.createdAt,
          };
      return { ...record, deduplicated: durableReceipt.deduplicated };
    }

    // Idempotency guard: prevent double-dispatch for same feature+phase
    const existing = this.getDispatch(
      request.featureId,
      request.phaseId,
      undefined,
      projectId,
    );
    if (
      existing &&
      (existing.status === "queued" || this.active.includes(existing))
    ) {
      return existing;
    }

    const backend =
      this.approvedBackend ??
      pillarBackend(this.config, "implement", request.backend);
    const tasks: TaskRecord[] = [];
    if (request.taskIds) {
      for (const id of request.taskIds) {
        tasks.push({
          id,
          status: "pending",
          sandboxDir: "",
          backend,
        });
      }
    } else if (request.taskId) {
      tasks.push({
        id: request.taskId,
        status: "pending",
        sandboxDir: "",
        backend,
      });
    }

    const record: DispatchRecord = {
      id: crypto.randomUUID(),
      projectId,
      featureId: request.featureId,
      phaseId: request.phaseId,
      backend,
      status: "queued",
      branchName: this.shipBranch(request.featureId, request.phaseId),
      projectRoot,
      trunkBranch,
      ...(recipient ? { recipient } : {}),
      attempts: [],
      tasks,
      createdAt: new Date().toISOString(),
    };

    persistDispatch(record, record.projectRoot);
    this.queue.push(record);
    this.processNext();
    return record;
  }

  private hasWorkerCapacity() {
    return (
      this.active.length + this.activeDurableOps.size <
      this.config.parallelism.local.maxClones
    );
  }

  private scheduleDrain() {
    if (this.closed || this.paused || this.scheduledDrain) return;
    this.scheduledDrain = setImmediate(() => {
      this.scheduledDrain = undefined;
      void this.processNext();
    });
  }

  async processNext() {
    if (this.paused || this.closed) {
      return;
    }

    if (this.monitor.isThrottled()) {
      return;
    }

    if (this.durableService) {
      const pass = this.startupRecovered
        ? this.durableService.drainReady(
            this.ownerId,
            this.config.parallelism.local.maxClones,
          )
        : this.recoverOnStartup();
      const durableWork = pass
        .then(() => undefined)
        .catch((error: unknown) => {
          this.errors.push(error);
          logCliError("Durable dispatch drain failed:", error);
        })
        .finally(() => this.inFlight.delete(durableWork));
      this.inFlight.add(durableWork);
    }

    if (this.queue.length === 0) return;

    // Capacity: each active record is one feature-phase ship in its own
    // worktree. Cap concurrent ships at maxClones — this is the queue's ship
    // gate that superseded DispatchOrchestrator's per-task Semaphore (PR-8).
    if (!this.hasWorkerCapacity()) return;

    const record = this.queue.shift();
    if (!record) return;

    this.active.push(record);
    record.status = "running";

    // Run in background
    const work = this.runDispatch(record)
      .catch((error: unknown) => {
        this.errors.push(error);
        logCliError("Dispatch failed:", error);
      })
      .finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
  }

  private async runDispatch(record: DispatchRecord) {
    const attempt: DispatchAttempt = {
      attemptNumber: record.attempts.length + 1,
      backend: record.backend,
      startedAt: new Date().toISOString(),
    };

    record.attempts.push(attempt);

    const shipBranch = this.shipBranch(record.featureId, record.phaseId);
    let exitCode: number;
    let stderr: string;

    try {
      persistDispatch(record, record.projectRoot);
      attempt.runId = startRun(
        {
          feature_id: record.featureId,
          phase_id: record.phaseId,
          project_id: record.projectId,
          command: `gwrk ship ${record.featureId} ${record.phaseId}`,
          agent_backend: record.backend,
          workflow: "work-until-done",
        },
        this.ledger?.db,
      );
      const worktreeDir = await this.sandbox.createSandbox({
        featureId: record.featureId,
        phaseId: record.phaseId,
        taskId: "ship",
        backend: record.backend,
        projectRoot: record.projectRoot,
        baseBranch: record.trunkBranch,
        branchName: shipBranch,
        setup: this.config.worktree?.setup,
      });
      record.workDir = worktreeDir;
      record.branchName = shipBranch;
      try {
        persistDispatch(record, record.projectRoot);
      } catch (error) {
        this.errors.push(error);
        throw error;
      }

      const orchestrator = new ShipOrchestrator({
        featureId: record.featureId,
        phaseId: record.phaseId,
        backend: record.backend,
        maxIterations: 3,
        ciTimeout: 30,
        cwd: worktreeDir,
        gitEnv: this.gitEnv?.(),
        stateRoot: record.projectRoot,
        branchName: shipBranch,
      });

      exitCode = await orchestrator.run();

      const result = orchestrator.getResult();
      if (result.prNumber) record.prNumber = result.prNumber;
      if (result.prUrl) record.prUrl = result.prUrl;

      stderr =
        exitCode === 0 ? "" : `ShipOrchestrator exited with code ${exitCode}`;
    } catch (error) {
      exitCode = 1;
      stderr = error instanceof Error ? error.message : String(error);
      if (attempt.runId === undefined) this.errors.push(error);
    }

    await this.handleCompletion(record.id, exitCode, stderr);
  }

  async handleCompletion(
    dispatchId: string,
    exitCode: number,
    stderr: string,
  ): Promise<void> {
    const record = this.active.find((r) => r.id === dispatchId);
    if (!record) return;

    const attempt = record.attempts[record.attempts.length - 1];
    attempt.completedAt = new Date().toISOString();
    attempt.exitCode = exitCode;
    attempt.stderr = stderr;
    record.status = exitCode === 0 ? "completed" : "failed";
    record.completedAt = attempt.completedAt;

    for (const task of record.tasks) {
      if (task.status === "running" || task.status === "pending") {
        task.status = exitCode === 0 ? "completed" : "failed";
        task.completedAt = attempt.completedAt;
        task.exitCode = exitCode;
        task.error = stderr;
      }
    }

    try {
      if (attempt.runId !== undefined) {
        const duration = Math.floor(
          (new Date(attempt.completedAt).getTime() -
            new Date(attempt.startedAt).getTime()) /
            1000,
        );
        finishRun(
          attempt.runId,
          {
            exit_code: exitCode,
            duration_s: duration,
          },
          this.ledger?.db,
        );
      }
    } finally {
      try {
        if (record.workDir) {
          await this.sandbox.destroySandbox(record.workDir, record.featureId, {
            autoCommitPush: false,
          });
          record.workDir = undefined;
        }
      } catch (error) {
        this.errors.push(error);
        logCliError("Failed to destroy sandbox:", error);
      }

      this.active = this.active.filter((r) => r.id !== record.id);
      this.history.push(record);
      try {
        persistDispatch(record, record.projectRoot);
      } catch (error) {
        this.errors.push(error);
        logCliError("Failed to journal dispatch outcome:", error);
      } finally {
        this.processNext();
      }
    }
    try {
      const enrolled = record.projectId
        ? (this.registry?.getProject(record.projectId) ?? null)
        : null;
      const isOps = Boolean(record.recipient?.opsOnly);
      let slackRecipient: DeliveryRecipient | undefined;
      let cardRootTs: string | undefined;

      if (enrolled) {
        const storedThread = !isOps
          ? (this.registry?.getFeatureThread(
              enrolled.projectId,
              record.featureId,
            ) ?? null)
          : null;
        const enrolledProjects = this.registry?.listProjects();
        const resolved = resolveProjectSlackRecipient({
          project: enrolled,
          enrolledProjects,
          storedThread,
          recipient: record.recipient ?? undefined,
          opsOnly: isOps,
        });
        if (resolved.ok) {
          slackRecipient = resolved.recipient;
          cardRootTs =
            resolved.recipient?.threadTs ?? resolved.validStoredThread?.rootTs;
        } else {
          const fallback = resolveProjectSlackRecipient({
            project: enrolled,
            enrolledProjects,
            storedThread,
            opsOnly: isOps,
          });
          if (fallback.ok) {
            slackRecipient = fallback.recipient;
            cardRootTs =
              fallback.recipient?.threadTs ??
              fallback.validStoredThread?.rootTs;
          }
        }
      } else if (record.recipient?.surface === "slack") {
        slackRecipient = record.recipient;
        cardRootTs = isOps ? undefined : record.recipient.threadTs;
      }

      const cardRecord = {
        ...record,
        ...(enrolled?.slug ? { projectSlug: enrolled.slug } : {}),
        ...(cardRootTs ? { rootTs: cardRootTs } : {}),
      };

      const notificationProjectId =
        this.registry || record.recipient ? record.projectId : undefined;
      const notifyOptions = {
        projectRoot: record.projectRoot,
        signal: this.notificationShutdown.signal,
        transportTimeoutMs: 5_000,
        projectId: notificationProjectId,
        recipient: slackRecipient,
        featureId: record.featureId,
        registry: this.registry,
        ...(slackRecipient?.opsOnly ? { opsOnly: true } : {}),
      };

      if (exitCode === 0) {
        record.status = "completed";
        record.completedAt = attempt.completedAt;

        await notifySlack(
          MessageBuilder.reviewReady(cardRecord),
          {
            type: "review_ready",
            feature: record.featureId,
            phase: record.phaseId,
            projectId: notificationProjectId,
            recipient: slackRecipient,
            ...(slackRecipient?.opsOnly ? { opsOnly: true } : {}),
            payload: record as unknown as Record<string, unknown>,
            timestamp: new Date().toISOString(),
          },
          notifyOptions,
        );
      } else {
        record.status = "failed";
        await notifySlack(
          MessageBuilder.phaseFail(cardRecord, stderr),
          {
            type: "phase_fail",
            feature: record.featureId,
            phase: record.phaseId,
            projectId: notificationProjectId,
            recipient: slackRecipient,
            ...(slackRecipient?.opsOnly ? { opsOnly: true } : {}),
            payload: { ...record, stderr } as unknown as Record<
              string,
              unknown
            >,
            timestamp: new Date().toISOString(),
          },
          notifyOptions,
        );
      }
    } catch (error) {
      logCliError("Failed to notify dispatch outcome:", error);
    }
  }

  private listDurableQueuedRecords(): DispatchRecord[] {
    if (!this.durableStore) return [];
    return this.durableStore
      .listRecoverableDispatches({ nowIso: this.clock.nowIso() })
      .filter(
        (op) =>
          op.status === "accepted" &&
          !this.activeDurableOps.has(op.operationId),
      )
      .map((op) =>
        operationToRecord(
          op,
          this.durableRegistry?.getProject(op.projectId) ?? undefined,
        ),
      );
  }

  getQueue(projectId?: string) {
    const durableActive = [...this.activeDurableOps.values()].map((op) =>
      operationToRecord(
        op,
        this.durableRegistry?.getProject(op.projectId) ?? undefined,
      ),
    );
    const durableQueued = this.listDurableQueuedRecords();
    return {
      active: [...this.active, ...durableActive].filter((record) =>
        this.matchesProject(record, projectId),
      ),
      queued: [...this.queue, ...durableQueued].filter((record) =>
        this.matchesProject(record, projectId),
      ),
      throttled: this.monitor.isThrottled(),
      paused: this.paused,
    };
  }

  getDispatch(
    featureId: string,
    phaseId: string,
    taskId?: string,
    projectId?: string,
  ): DispatchRecord | null {
    const legacy =
      this.active.find(
        (r) =>
          r.featureId === featureId &&
          r.phaseId === phaseId &&
          (!taskId || r.tasks.some((t) => t.id === taskId)) &&
          this.matchesProject(r, projectId),
      ) ||
      this.queue.find(
        (r) =>
          r.featureId === featureId &&
          r.phaseId === phaseId &&
          (!taskId || r.tasks.some((t) => t.id === taskId)) &&
          this.matchesProject(r, projectId),
      ) ||
      this.history.find(
        (r) =>
          r.featureId === featureId &&
          r.phaseId === phaseId &&
          (!taskId || r.tasks.some((t) => t.id === taskId)) &&
          this.matchesProject(r, projectId),
      );
    if (legacy) return legacy;

    if (this.durableService && this.durableRegistry) {
      const resolvedProjectId =
        (projectId
          ? (this.durableRegistry.getProject(projectId)?.projectId ?? projectId)
          : undefined) ??
        this.durableRegistry.findByLocalRoot(this.projectRoot)?.projectId ??
        this.ledger?.projectId;
      if (resolvedProjectId) {
        const op = this.durableService.getOperation(
          resolvedProjectId,
          featureId,
          phaseId,
        );
        if (op && (!taskId || op.taskIds.includes(taskId))) {
          return operationToRecord(
            op,
            this.durableRegistry?.getProject(op.projectId) ?? undefined,
          );
        }
      }
    }
    return null;
  }

  getFeatureDispatch(
    featureId: string,
    projectId?: string,
  ): DispatchRecord | null {
    const effectiveProjectId =
      projectId ??
      this.registry?.findByLocalRoot(this.projectRoot)?.projectId ??
      this.ledger?.projectId;
    const snapshot = this.getQueue(effectiveProjectId);
    return (
      snapshot.active.find((record) => record.featureId === featureId) ??
      snapshot.queued.find((record) => record.featureId === featureId) ??
      null
    );
  }

  getQueueDepth(projectId?: string): number {
    return this.getQueue(projectId).queued.length;
  }

  getActiveCount(projectId?: string): number {
    return this.getQueue(projectId).active.length;
  }

  getCompletedCount(projectId?: string): number {
    const durable = [...this.completedDurableIds.values()].filter(
      (completedProjectId) =>
        !projectId ||
        completedProjectId ===
          (this.registry?.getProject(projectId)?.projectId ?? projectId),
    );
    return (
      this.history.filter(
        (r) => r.status === "completed" && this.matchesProject(r, projectId),
      ).length + durable.length
    );
  }

  getFailedCount(projectId?: string): number {
    const durable = [...this.failedDurableIds.values()].filter(
      (completedProjectId) =>
        !projectId ||
        completedProjectId ===
          (this.registry?.getProject(projectId)?.projectId ?? projectId),
    );
    return (
      this.history.filter(
        (r) => r.status === "failed" && this.matchesProject(r, projectId),
      ).length + durable.length
    );
  }
}
