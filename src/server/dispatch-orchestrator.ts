import type { GwrkConfig, AgentBackend } from "../utils/config.js";
import type { SandboxManager } from "./sandbox.js";
import type { InvocationStrategy, TaskInvocation } from "./backends/invocation-strategy.js";
import type { TaskResult } from "../utils/agent.js";

export interface OrchestratorOptions {
  featureId: string;
  phaseId: string;
  tasks: Array<{ id: string; prompt?: string }>;
  backend?: AgentBackend;
  concurrency?: number;
}

export interface TaskStatus {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: TaskResult;
  workDir?: string;
}

export class DispatchOrchestrator {
  private activeCount = 0;
  private queue: Array<{ id: string; prompt?: string }> = [];
  private statuses: Map<string, TaskStatus> = new Map();
  private maxConcurrency: number;
  private queueTimeoutMs = 60 * 60 * 1000; // 1 hour

  constructor(
    private config: GwrkConfig,
    private sandbox: SandboxManager,
    private invocation: InvocationStrategy,
  ) {
    this.maxConcurrency = this.config.parallelism.local.maxClones;
  }

  async dispatchPhase(opts: OrchestratorOptions): Promise<TaskStatus[]> {
    this.queue = [...opts.tasks];
    this.maxConcurrency = opts.concurrency || this.maxConcurrency;
    const startTime = Date.now();
    
    for (const task of opts.tasks) {
      this.statuses.set(task.id, { taskId: task.id, status: "queued" });
    }

    const runners: Promise<void>[] = [];

    // Start initial batch
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      runners.push(this.runNext(opts, startTime));
    }

    // Wait for all tasks to complete or timeout
    await Promise.all(runners);
    
    // Check if any tasks timed out in queue
    for (const [taskId, status] of this.statuses.entries()) {
      if (status.status === "queued") {
        status.status = "failed";
        status.result = {
          exitCode: 1,
          stderr: "Agent capacity queue timeout",
          stdout: "",
          durationS: 0,
        };
      }
    }

    return Array.from(this.statuses.values());
  }

  private async runNext(opts: OrchestratorOptions, startTime: number): Promise<void> {
    if (Date.now() - startTime > this.queueTimeoutMs) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;
    const status = this.statuses.get(task.id)!;
    status.status = "running";

    let workDir: string | undefined;
    try {
      // 1. Create Sandbox
      workDir = await this.sandbox.createSandbox({
        featureId: opts.featureId,
        phaseId: opts.phaseId,
        taskId: task.id,
        backend: opts.backend || this.config.agents.implement,
        projectRoot: process.cwd(),
      });
      status.workDir = workDir;

      // 2. Invoke Agent
      const result = await this.invocation.invoke({
        taskId: task.id,
        featureId: opts.featureId,
        phaseId: opts.phaseId,
        backend: opts.backend || this.config.agents.implement,
        workDir,
        prompt: task.prompt,
      });

      status.result = result;
      status.status = result.exitCode === 0 ? "completed" : "failed";
    } catch (e: any) {
      status.status = "failed";
      status.result = {
        exitCode: 1,
        stderr: e.message,
        stdout: "",
        durationS: 0,
      };
    } finally {
      this.activeCount--;
      if (workDir) {
        try {
          await this.sandbox.destroySandbox(workDir, opts.featureId);
        } catch (e) {
          console.error(`Failed to destroy sandbox ${workDir}:`, e);
        }
      }
      
      // Try to run next if any left in queue and not timed out
      if (this.queue.length > 0 && (Date.now() - startTime < this.queueTimeoutMs)) {
        await this.runNext(opts, startTime);
      }
    }
  }
}
