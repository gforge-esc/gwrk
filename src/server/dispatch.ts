/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as crypto from "node:crypto";
import { logCliError } from "../adapters/cli/output-scope.js";
import { finishRun, startRun } from "../db/runs.js";
import type { DeliveryRecipient } from "../domain/project-registry.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
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

  constructor(
    private config: GwrkConfig,
    private monitor: SystemMonitor,
    private sandbox: SandboxManager,
    private projectRoot: string,
    private registry?: ProjectRegistryPort,
  ) {}

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.processNext();
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
      (existing.status === "queued" || existing.status === "running")
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
      projectId,
      featureId: request.featureId,
      phaseId: request.phaseId,
      backend: pillarBackend(this.config, "implement", request.backend),
      status: "queued",
      branchName: this.shipBranch(request.featureId, request.phaseId),
      projectRoot,
      trunkBranch,
      ...(recipient ? { recipient } : {}),
      attempts: [],
      tasks,
      createdAt: new Date().toISOString(),
    };

    this.queue.push(record);
    persistDispatch(record, record.projectRoot);
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
    persistDispatch(record, record.projectRoot);

    this.runDispatch(record).catch(console.error);
  }

  private async runDispatch(record: DispatchRecord) {
    const attempt: DispatchAttempt = {
      attemptNumber: record.attempts.length + 1,
      backend: record.backend,
      startedAt: new Date().toISOString(),
    };

    attempt.runId = startRun({
      feature_id: record.featureId,
      phase_id: record.phaseId,
      project_id: record.projectId,
      command: `gwrk ship ${record.featureId} ${record.phaseId}`,
      agent_backend: record.backend,
      workflow: "work-until-done",
    });

    record.attempts.push(attempt);

    const shipBranch = this.shipBranch(record.featureId, record.phaseId);

    try {
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
      persistDispatch(record, record.projectRoot);

      const orchestrator = new ShipOrchestrator({
        featureId: record.featureId,
        phaseId: record.phaseId,
        backend: record.backend,
        maxIterations: 3,
        ciTimeout: 30,
        cwd: worktreeDir,
        stateRoot: record.projectRoot,
        branchName: shipBranch,
      });

      const exitCode = await orchestrator.run();

      const result = orchestrator.getResult();
      if (result.prNumber) record.prNumber = result.prNumber;
      if (result.prUrl) record.prUrl = result.prUrl;

      await this.handleCompletion(
        record.id,
        exitCode,
        exitCode === 0 ? "" : `ShipOrchestrator exited with code ${exitCode}`,
      );
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      await this.handleCompletion(record.id, 1, errorMessage);
    }
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

    for (const task of record.tasks) {
      if (task.status === "running" || task.status === "pending") {
        task.status = exitCode === 0 ? "completed" : "failed";
        task.completedAt = attempt.completedAt;
        task.exitCode = exitCode;
        task.error = stderr;
      }
    }

    if (attempt.runId) {
      const duration = Math.floor(
        (new Date(attempt.completedAt).getTime() -
          new Date(attempt.startedAt).getTime()) /
          1000,
      );
      finishRun(attempt.runId, {
        exit_code: exitCode,
        duration_s: duration,
      });
    }

    const notifyOptions = {
      projectId: record.projectId,
      recipient: record.recipient,
      featureId: record.featureId,
      registry: this.registry,
    };

    if (exitCode === 0) {
      record.status = "completed";
      record.completedAt = attempt.completedAt;

      await notifySlack(
        MessageBuilder.reviewReady(record),
        {
          type: "review_ready",
          feature: record.featureId,
          phase: record.phaseId,
          projectId: record.projectId,
          recipient: record.recipient,
          payload: record as unknown as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        },
        notifyOptions,
      );
    } else {
      record.status = "failed";
      await notifySlack(
        MessageBuilder.phaseFail(record, stderr),
        {
          type: "phase_fail",
          feature: record.featureId,
          phase: record.phaseId,
          projectId: record.projectId,
          recipient: record.recipient,
          payload: { ...record, stderr } as unknown as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        },
        notifyOptions,
      );
    }

    this.active = this.active.filter((r) => r.id !== record.id);
    this.history.push(record);

    if (record.workDir) {
      try {
        await this.sandbox.destroySandbox(record.workDir, record.featureId, {
          autoCommitPush: false,
        });
      } catch (e) {
        logCliError("Failed to destroy sandbox:", e);
      }
      record.workDir = undefined;
    }

    persistDispatch(record, record.projectRoot);
    this.processNext();
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
