/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as crypto from "node:crypto";
import type Database from "better-sqlite3";
import { logCliError } from "../adapters/cli/output-scope.js";
import { finishRun, startRun } from "../db/runs.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { AgentBackendId, GwrkConfig } from "../utils/config.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";

import { pillarBackend } from "../utils/resolve-agent.js";
import type { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchAttempt, DispatchRecord, TaskRecord } from "./types.js";

export interface DispatchRequest {
  featureId: string;
  phaseId: string;
  taskId?: string;
  taskIds?: string[]; // NEW: For multiple tasks
  backend?: AgentBackendId;
  parallel?: boolean; // NEW: Enable parallel dispatch
}

export interface DispatchLedgerScope {
  db: Database.Database;
  projectId: string;
}

/**
 * DispatchQueue — the daemon's entry point into the unified ship engine.
 *
 * A dispatch is a **feature-phase**: the queue isolates it in a git worktree
 * and drives the SAME `ShipOrchestrator` the CLI (`gwrk ship`) uses, running
 * the full lifecycle (branch → implement → gates → review → PR to develop).
 * Concurrency is across feature-phases, bounded by `parallelism.local.maxClones`
 * — the queue's own active-ship gate, which replaced `DispatchOrchestrator`'s
 * bespoke per-task Semaphore fan-out (PR-8).
 *
 * The daemon does NOT merge locally: the engine opens the PR and harvest
 * finalizes post-merge from GitHub (the ship↔harvest seam, PR-3).
 */
export class DispatchQueue {
  private queue: DispatchRecord[] = [];
  private active: DispatchRecord[] = [];
  private history: DispatchRecord[] = [];
  private paused = false;
  private closed = false;
  private inFlight = new Set<Promise<void>>();
  private errors: unknown[] = [];

  constructor(
    private config: GwrkConfig,
    private monitor: SystemMonitor,
    private sandbox: SandboxManager,
    private projectRoot: string,
    private ledger?: DispatchLedgerScope,
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

  enqueue(request: DispatchRequest): DispatchRecord {
    if (this.closed) throw new Error("Dispatch queue is closed");

    // Idempotency guard: prevent double-dispatch for same feature+phase
    const existing = this.getDispatch(request.featureId, request.phaseId);
    if (
      existing &&
      (existing.status === "queued" || this.active.includes(existing))
    ) {
      return existing;
    }

    const tasks: TaskRecord[] = [];
    if (request.taskIds) {
      for (const id of request.taskIds) {
        tasks.push({
          id,
          status: "pending",
          sandboxDir: "",
          backend: pillarBackend(this.config, "implement", request.backend),
        });
      }
    } else if (request.taskId) {
      tasks.push({
        id: request.taskId,
        status: "pending",
        sandboxDir: "",
        backend: pillarBackend(this.config, "implement", request.backend),
      });
    }

    const record: DispatchRecord = {
      id: crypto.randomUUID(),
      featureId: request.featureId,
      phaseId: request.phaseId,
      backend: pillarBackend(this.config, "implement", request.backend),
      status: "queued",
      branchName: this.shipBranch(request.featureId, request.phaseId),
      attempts: [],
      tasks,
      createdAt: new Date().toISOString(),
    };

    persistDispatch(record, this.projectRoot);
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
      // Potentially log or wait
      return;
    }

    // Capacity: each active record is one feature-phase ship in its own
    // worktree. Cap concurrent ships at maxClones — this is the queue's ship
    // gate that superseded DispatchOrchestrator's per-task Semaphore (PR-8).
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
      persistDispatch(record, this.projectRoot);
      attempt.runId = startRun(
        {
          feature_id: record.featureId,
          phase_id: record.phaseId,
          command: `gwrk ship ${record.featureId} ${record.phaseId}`,
          agent_backend: record.backend,
          workflow: "work-until-done",
          project_id: this.ledger?.projectId,
        },
        this.ledger?.db,
      );

      // Isolate the feature-phase in a git worktree and drive the SAME unified
      // ShipOrchestrator the CLI uses. The orchestrator owns branch setup,
      // implement, build/test gates, review and the PR (→ develop). The daemon
      // only supplies the isolated worktree and records the outcome; there is
      // NO local merge-back — harvest finalizes post-merge from GitHub.
      const worktreeDir = await this.sandbox.createSandbox({
        featureId: record.featureId,
        phaseId: record.phaseId,
        taskId: "ship",
        backend: record.backend,
        projectRoot: this.projectRoot,
        baseBranch: "develop",
        branchName: shipBranch,
        setup: this.config.worktree?.setup,
      });
      record.workDir = worktreeDir;
      record.branchName = shipBranch;
      try {
        persistDispatch(record, this.projectRoot);
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
        // Crash-recovery state lives in the primary checkout so it survives
        // worktree teardown; ship on the per-feature-phase branch.
        stateRoot: this.projectRoot,
        branchName: shipBranch,
      });

      exitCode = await orchestrator.run();

      // Surface PR metadata for the review-ready notification.
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

    // Reflect the ship outcome on any task records (status dashboards read them).
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

      try {
        if (exitCode === 0) {
          // The unified engine already opened the PR (PR_CI → develop). Notify with
          // the review/merge CTA. Harvest runs the Done-Done finalizer post-merge.
          await notifySlack(MessageBuilder.reviewReady(record), {
            type: "review_ready",
            feature: record.featureId,
            phase: record.phaseId,
            payload: record as unknown as Record<string, unknown>,
            timestamp: new Date().toISOString(),
          });
        } else {
          await notifySlack(MessageBuilder.phaseFail(record, stderr), {
            type: "phase_fail",
            feature: record.featureId,
            phase: record.phaseId,
            payload: { ...record, stderr } as unknown as Record<
              string,
              unknown
            >,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        logCliError("Failed to notify dispatch outcome:", error);
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
        persistDispatch(record, this.projectRoot);
      } catch (error) {
        this.errors.push(error);
        logCliError("Failed to journal dispatch outcome:", error);
      } finally {
        this.processNext();
      }
    }
  }

  getQueue() {
    return {
      active: this.active,
      queued: this.queue,
      throttled: this.monitor.isThrottled(),
      paused: this.paused,
    };
  }

  getDispatch(
    featureId: string,
    phaseId: string,
    taskId?: string,
  ): DispatchRecord | null {
    return (
      this.active.find(
        (r) =>
          r.featureId === featureId &&
          r.phaseId === phaseId &&
          (!taskId || r.tasks.some((t) => t.id === taskId)),
      ) ||
      this.queue.find(
        (r) =>
          r.featureId === featureId &&
          r.phaseId === phaseId &&
          (!taskId || r.tasks.some((t) => t.id === taskId)),
      ) ||
      this.history.find(
        (r) =>
          r.featureId === featureId &&
          r.phaseId === phaseId &&
          (!taskId || r.tasks.some((t) => t.id === taskId)),
      ) ||
      null
    );
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.active.length;
  }

  getCompletedCount(): number {
    return this.history.filter((r) => r.status === "completed").length;
  }

  getFailedCount(): number {
    return this.history.filter((r) => r.status === "failed").length;
  }
}
