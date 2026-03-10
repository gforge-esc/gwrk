import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { finishRun, startRun } from "../db/runs.js";
import type { AgentBackend, GwrkConfig } from "../utils/config.js";
import { compileContext } from "./context.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import { persistDispatch } from "./persistence.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchAttempt, DispatchRecord, SystemStatus } from "./types.js";

export interface DispatchRequest {
  featureId: string;
  phaseId: string;
  backend?: AgentBackend;
}

export class DispatchQueue {
  private queue: DispatchRecord[] = [];
  private active: DispatchRecord[] = [];
  private history: DispatchRecord[] = [];

  constructor(
    private config: GwrkConfig,
    private monitor: SystemMonitor,
    private sandbox: SandboxManager,
    private git: GitManager,
    private projectRoot: string,
  ) {}

  enqueue(request: DispatchRequest): DispatchRecord {
    const record: DispatchRecord = {
      id: crypto.randomUUID(),
      featureId: request.featureId,
      phaseId: request.phaseId,
      backend: request.backend || this.config.agents.implement,
      status: "queued",
      branchName: `phase/${request.featureId}-${request.phaseId}`,
      attempts: [],
      createdAt: new Date().toISOString(),
    };

    this.queue.push(record);
    persistDispatch(record);
    this.processNext();
    return record;
  }

  async processNext() {
    if (this.queue.length === 0) return;

    if (this.monitor.isThrottled()) {
      return;
    }

    if (this.active.length >= this.config.parallelism.local.maxClones) {
      return;
    }

    const record = this.queue.shift()!;
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
    record.attempts.push(attempt);

    const runId = startRun({
      feature_id: record.featureId,
      phase_id: record.phaseId,
      command: "ship",
      agent_backend: record.backend,
      workflow: "implement",
    });

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

      // 3. Create Sandbox
      const containerId = await this.sandbox.createSandbox({
        featureId: record.featureId,
        phaseId: record.phaseId,
        backend: record.backend,
        projectRoot: this.projectRoot,
      });
      record.containerId = containerId;

      // 4. Simulate Agent Execution (using actual ship command placeholder)
      // In real life we would run something like:
      // docker exec <id> node /workspace/dist/cli.js ship implement <featureId> --phase <phaseId>

      // Just a sleep to simulate work as requested for now
      await new Promise((resolve) => setTimeout(resolve, 2000));

      record.status = "completed";
      attempt.completedAt = new Date().toISOString();
      attempt.exitCode = 0;

      finishRun(runId, {
        exit_code: 0,
        duration_s: Math.round(
          (Date.now() - new Date(attempt.startedAt).getTime()) / 1000,
        ),
      });
    } catch (e: any) {
      attempt.completedAt = new Date().toISOString();
      attempt.exitCode = 1;

      finishRun(runId, {
        exit_code: 1,
        duration_s: Math.round(
          (Date.now() - new Date(attempt.startedAt).getTime()) / 1000,
        ),
      });

      if (record.attempts.length < 3) {
        record.status = "retrying";
      } else {
        // Fallback logic
        const fallbackOrder = this.config.agents.fallbackOrder || [];
        const currentIndex = fallbackOrder.indexOf(record.backend);
        if (currentIndex !== -1 && currentIndex < fallbackOrder.length - 1) {
          record.backend = fallbackOrder[currentIndex + 1];
          record.status = "retrying";
          record.attempts = [];
        } else {
          record.status = "failed";
        }
      }
    } finally {
      if (record.containerId) {
        await this.sandbox.destroySandbox(record.containerId);
        record.containerId = undefined;
      }

      this.active = this.active.filter((r) => r.id !== record.id);

      if (record.status === "retrying") {
        this.queue.push(record);
      } else {
        this.history.push(record);
        record.completedAt = new Date().toISOString();
      }

      persistDispatch(record);
      this.processNext();
    }
  }

  getStatus() {
    return {
      active: this.active,
      queued: this.queue,
      history: this.history,
    };
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
