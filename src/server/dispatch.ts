import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { finishRun, startRun } from "../db/runs.js";
import type { AgentBackend, GwrkConfig } from "../utils/config.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";
import type { SlackEvent } from "./slack-presence.js";

import { compileContext } from "./context.js";
import type { DispatchOrchestrator } from "./dispatch-orchestrator.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchAttempt, DispatchRecord, TaskRecord } from "./types.js";

export interface DispatchRequest {
  featureId: string;
  phaseId: string;
  taskId?: string;
  taskIds?: string[]; // NEW: For multiple tasks
  backend?: AgentBackend;
  parallel?: boolean; // NEW: Enable parallel dispatch
}

export class DispatchQueue {
  private queue: DispatchRecord[] = [];
  private active: DispatchRecord[] = [];
  private history: DispatchRecord[] = [];
  private paused = false;

  constructor(
    private config: GwrkConfig,
    private monitor: SystemMonitor,
    private sandbox: SandboxManager,
    private git: GitManager,
    private orchestrator: DispatchOrchestrator,
    private projectRoot: string,
  ) {}

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.processNext();
  }

  enqueue(request: DispatchRequest): DispatchRecord {
    // Idempotency guard: prevent double-dispatch for same feature+phase
    const existing = this.getDispatch(request.featureId, request.phaseId);
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
          backend: request.backend || this.config.agents.implement,
        });
      }
    } else if (request.taskId) {
      tasks.push({
        id: request.taskId,
        status: "pending",
        sandboxDir: "",
        backend: request.backend || this.config.agents.implement,
      });
    }

    const record: DispatchRecord = {
      id: crypto.randomUUID(),
      featureId: request.featureId,
      phaseId: request.phaseId,
      backend: request.backend || this.config.agents.implement,
      status: "queued",
      branchName: `phase/${request.featureId}-${request.phaseId}`,
      attempts: [],
      tasks,
      createdAt: new Date().toISOString(),
      workDir: request.parallel ? undefined : "", // Mark if parallel or single
    };

    this.queue.push(record);
    persistDispatch(record);
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

    // Capacity check: count active sandboxes instead of just active phase records
    const activeSandboxCount = this.active.reduce(
      (acc, r) => acc + r.tasks.filter((t) => t.status === "running").length,
      0,
    );
    if (activeSandboxCount >= this.config.parallelism.local.maxClones) {
      return;
    }

    const record = this.queue.shift();
    if (!record) return;

    this.active.push(record);
    record.status = "running";
    persistDispatch(record);

    // Run in background
    this.runDispatch(record).catch(console.error);
  }

  private async runDispatch(record: DispatchRecord) {
    const attempt: DispatchAttempt = {
      attemptNumber: record.attempts.length + 1,
      backend: record.backend,
      startedAt: new Date().toISOString(),
    };

    const taskId = record.tasks.length === 1 ? record.tasks[0].id : "all";
    attempt.runId = startRun({
      feature_id: record.featureId,
      phase_id: record.phaseId,
      command: `gwrk ship implement ${record.featureId} --phase ${record.phaseId}${taskId !== "all" ? ` --task ${taskId}` : ""}`,
      agent_backend: record.backend,
      workflow: "implement",
    });

    record.attempts.push(attempt);

    // Phase Start Notification
    if (record.attempts.length === 1) {
      await notifySlack(MessageBuilder.phaseStart(record), {
        type: "phase_start",
        feature: record.featureId,
        phase: record.phaseId,
        payload: record as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      // 1. Prepare Git
      this.git.createPhaseBranch(record.featureId, record.phaseId);

      // 2. Prepare Context
      const context = compileContext(
        this.projectRoot,
        record.featureId,
        record.phaseId,
      );
      const contextPath = path.join(
        this.projectRoot,
        ".gwrk",
        "phase-context.md",
      );
      fs.mkdirSync(path.dirname(contextPath), { recursive: true });
      fs.writeFileSync(contextPath, context);

      // 3. Dispatch Tasks
      if (record.tasks.length > 0) {
        const results = await this.orchestrator.dispatchPhase({
          featureId: record.featureId,
          phaseId: record.phaseId,
          tasks: record.tasks.map((t) => ({ id: t.id, backend: t.backend })),
          // Use config limit by default, orchestrator handles it
        });

        // Update task records in dispatch record
        for (const res of results) {
          const task = record.tasks.find((t) => t.id === res.id);
          if (task) {
            Object.assign(task, res);
          }
        }

        const anyFailed = results.some((r) => r.status === "failed");
        await this.handleCompletion(
          record.id,
          anyFailed ? 1 : 0,
          anyFailed ? "Some tasks failed" : "",
        );
      } else {
        // Fallback for phase-level implementation (Phase 06)
        // Simulate Agent Execution (for now)
        await new Promise((resolve) => setTimeout(resolve, 50));
        await this.handleCompletion(record.id, 0, "");
      }
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

    // Only update tasks if they haven't been updated by orchestrator
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

    if (exitCode === 0) {
      record.status = "completed";
      record.completedAt = attempt.completedAt;

      await notifySlack(MessageBuilder.phaseComplete(record), {
        type: "phase_complete",
        feature: record.featureId,
        phase: record.phaseId,
        payload: record as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });

      // Merge back
      try {
        this.git.mergePhaseBack(record.featureId, record.phaseId);
      } catch (e) {
        console.error("Merge back failed:", e);
        // We still mark as completed, but merge failure is logged
      }
    } else {
      if (record.attempts.length < 3) {
        record.status = "retrying";
      } else {
        // Escalate to next backend in fallbackOrder
        const fallbackOrder: AgentBackend[] = [
          "gemini",
          "claude",
          "codex",
          "codex-cloud",
        ];
        const currentIndex = fallbackOrder.indexOf(record.backend);
        if (currentIndex !== -1 && currentIndex < fallbackOrder.length - 1) {
          record.backend = fallbackOrder[currentIndex + 1];
          record.status = "retrying";
        } else {
          record.status = "failed";
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
      }
    }

    // Move from active to history/queue
    this.active = this.active.filter((r) => r.id !== record.id);

    if (record.status === "retrying") {
      this.queue.push(record);
    } else {
      this.history.push(record);
    }

    if (record.workDir) {
      try {
        await this.sandbox.destroySandbox(record.workDir, record.featureId);
      } catch (e) {
        console.error("Failed to destroy sandbox:", e);
      }
      record.workDir = undefined;
    }

    persistDispatch(record);
    this.processNext();
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
