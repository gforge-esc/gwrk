/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as crypto from "node:crypto";
import type Database from "better-sqlite3";
import { logCliError } from "../adapters/cli/output-scope.js";
import { finishRun, startRun } from "../db/runs.js";
import type { DeliveryRecipient } from "../domain/project-registry.js";
import { resolveProjectSlackRecipient } from "../domain/slack-delivery.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { AgentBackendId, GwrkConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";
import { pillarBackend } from "../utils/resolve-agent.js";
import type { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import type { SandboxManager } from "./sandbox.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";
import type {
  DispatchAttempt,
  DispatchRecord,
  DispatchRequest,
  TaskRecord,
} from "./types.js";

export type { DispatchRequest } from "./types.js";

export interface DispatchLedgerScope {
  db: Database.Database;
  projectId: string;
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

  constructor(
    private config: GwrkConfig,
    private monitor: SystemMonitor,
    private sandbox: SandboxManager,
    private projectRoot: string,
    private ledger?: DispatchLedgerScope,
    private gitEnv?: () => NodeJS.ProcessEnv,
    private readonly approvedBackend?: AgentBackendId,
    private registry?: ProjectRegistryPort,
  ) {}

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
    this.pause();
    this.notificationShutdown.abort();
    await Promise.all(this.inFlight);
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
        throw new Error(`Project is not enrolled: ${request.projectId}`);
      }

      const recipientProject = request.recipient?.projectId
        ? this.registry.getProject(request.recipient.projectId)
        : null;
      if (request.recipient?.projectId && !recipientProject) {
        throw new Error(
          `Recipient project is not enrolled: ${request.recipient.projectId}`,
        );
      }

      if (
        requestedProject &&
        recipientProject &&
        requestedProject.projectId !== recipientProject.projectId
      ) {
        throw new Error(
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
          throw new Error(recipientCheck.message);
        }
      }

      const projectId =
        enrolled?.projectId ?? resolveProjectId(this.projectRoot);
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
      throw new Error(
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

    // Idempotency guard: prevent double-dispatch for same (projectId, featureId, phaseId)
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

  async processNext() {
    if (this.queue.length === 0) return;

    if (this.paused) {
      return;
    }

    if (this.monitor.isThrottled()) {
      return;
    }

    if (this.active.length >= this.config.parallelism.local.maxClones) {
      return;
    }

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
      const enrolled = this.registry?.getProject(record.projectId) ?? null;
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
          recipient: record.recipient,
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

  getQueue(projectId?: string) {
    return {
      active: projectId
        ? this.active.filter((r) => this.matchesProject(r, projectId))
        : this.active,
      queued: projectId
        ? this.queue.filter((r) => this.matchesProject(r, projectId))
        : this.queue,
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
    const matches = (r: DispatchRecord) =>
      r.featureId === featureId &&
      r.phaseId === phaseId &&
      (!taskId || r.tasks.some((t) => t.id === taskId)) &&
      this.matchesProject(r, projectId);

    return (
      this.active.find(matches) ||
      this.queue.find(matches) ||
      this.history.find(matches) ||
      null
    );
  }

  getQueueDepth(projectId?: string): number {
    return this.queue.filter((r) => this.matchesProject(r, projectId)).length;
  }

  getActiveCount(projectId?: string): number {
    return this.active.filter((r) => this.matchesProject(r, projectId)).length;
  }

  getCompletedCount(projectId?: string): number {
    return this.history.filter(
      (r) => r.status === "completed" && this.matchesProject(r, projectId),
    ).length;
  }

  getFailedCount(projectId?: string): number {
    return this.history.filter(
      (r) => r.status === "failed" && this.matchesProject(r, projectId),
    ).length;
  }
}
