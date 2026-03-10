import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { DispatchRecord, DispatchAttempt, SystemStatus } from "./types.js";
import type { GwrkConfig, AgentBackend } from "../utils/config.js";
import type { SystemMonitor } from "./monitor.js";
import type { SandboxManager } from "./sandbox.js";
import type { GitManager } from "./git-manager.js";
import { compileContext } from "./context.js";
import { persistDispatch } from "./persistence.js";

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
    private projectRoot: string
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
    };
    
    this.queue.push(record);
    persistDispatch(record);
    this.processNext();
    return record;
  }

  async processNext() {
    if (this.queue.length === 0) return;
    
    if (this.monitor.isThrottled(this.config)) {
      // Potentially log or wait
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
      backend: record.backend,
      startedAt: new Date().toISOString(),
    };
    record.attempts.push(attempt);

    try {
      // 1. Prepare Git
      this.git.createPhaseBranch(record.featureId, record.phaseId);

      // 2. Prepare Context
      const context = compileContext(this.projectRoot, record.featureId, record.phaseId);
      const contextPath = path.join(this.projectRoot, ".gwrk", "phase-context.md");
      fs.mkdirSync(path.dirname(contextPath), { recursive: true });
      fs.writeFileSync(contextPath, context);

      // 3. Create Sandbox
      const containerId = await this.sandbox.createSandbox({
        featureId: record.featureId,
        phaseId: record.phaseId,
        projectRoot: this.projectRoot,
      });
      record.containerId = containerId;

      // 4. Simulate Agent Execution (for now)
      // In real life we would run something like:
      // docker exec <id> gwrk ship implement <featureId> --phase <phaseId>
      
      // Just a sleep to simulate work
      await new Promise(resolve => setTimeout(resolve, 2000));

      record.status = "completed";
      attempt.finishedAt = new Date().toISOString();
      attempt.exitCode = 0;
      
    } catch (e: any) {
      attempt.finishedAt = new Date().toISOString();
      attempt.exitCode = 1;
      
      if (record.attempts.length < 3) {
        record.status = "retrying";
      } else {
        record.status = "failed";
        // Escalation could happen here by changing backend and re-queuing
      }
    } finally {
      if (record.containerId) {
        await this.sandbox.destroySandbox(record.containerId);
        record.containerId = undefined;
      }
      
      this.active = this.active.filter(r => r.id !== record.id);
      
      if (record.status === "retrying") {
        this.queue.push(record);
      } else {
        this.history.push(record);
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
}
