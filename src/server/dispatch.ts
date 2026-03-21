import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { finishRun, startRun } from "../db/runs.js";
import type { AgentBackend, GwrkConfig } from "../utils/config.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";
import type { SlackEvent } from "./slack-presence.js";

import { compileContext } from "./context.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchAttempt, DispatchRecord } from "./types.js";

export interface DispatchRequest {
  featureId: string;
  phaseId: string;
  taskId?: string;
  backend?: AgentBackend;
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

    const record: DispatchRecord = {
      id: crypto.randomUUID(),
      featureId: request.featureId,
      phaseId: request.phaseId,
      backend: request.backend || this.config.agents.implement,
      status: "queued",
      branchName: `phase/${request.featureId}-${request.phaseId}`,
      attempts: [],
      tasks: request.taskId ? [{
        id: request.taskId,
        status: "pending",
        sandboxDir: "", // Will be set in runDispatch
        backend: request.backend || this.config.agents.implement,
      }] : [],
      createdAt: new Date().toISOString(),
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

    if (this.active.length >= this.config.parallelism.local.maxClones) {
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

    const taskId = record.tasks.length > 0 ? record.tasks[0].id : "all";
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

      // 3. Create Sandbox (For first task for now)
      if (record.tasks.length > 0) {
        const task = record.tasks[0];
        task.status = "running";
        task.startedAt = new Date().toISOString();
        
        const workDir = await this.sandbox.createSandbox({
          featureId: record.featureId,
          phaseId: record.phaseId,
          taskId: task.id,
          backend: record.backend,
          projectRoot: this.projectRoot,
        });
        task.sandboxDir = workDir;
        record.workDir = workDir;
      }

      // 4. Simulate Agent Execution (for now)
      // TODO: Phase 06 — real agent execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      await this.handleCompletion(record.id, 0, "");
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

    if (record.tasks.length > 0) {
      const task = record.tasks[0];
      task.status = exitCode === 0 ? "completed" : "failed";
      task.completedAt = attempt.completedAt;
      task.exitCode = exitCode;
      task.error = stderr;
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
        await this.sandbox.destroySandbox(record.workDir);
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

  getDispatch(featureId: string, phaseId: string, taskId?: string): DispatchRecord | null {
    return (
      this.active.find(
        (r) => r.featureId === featureId && r.phaseId === phaseId && (!taskId || r.tasks.some(t => t.id === taskId)),
      ) ||
      this.queue.find(
        (r) => r.featureId === featureId && r.phaseId === phaseId && (!taskId || r.tasks.some(t => t.id === taskId)),
      ) ||
      this.history.find(
        (r) => r.featureId === featureId && r.phaseId === phaseId && (!taskId || r.tasks.some(t => t.id === taskId)),
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
