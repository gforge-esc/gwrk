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
    
    for (const task of opts.tasks) {
      this.statuses.set(task.id, { taskId: task.id, status: "queued" });
    }

    const runners: Promise<void>[] = [];
    const totalTasks = this.queue.length;

    // Start initial batch
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      runners.push(this.runNext(opts));
    }

    // Wait for all tasks to complete
    await Promise.all(runners);
    
    // In case some were still in queue
    while (this.queue.length > 0 || this.activeCount > 0) {
      if (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
        await this.runNext(opts);
      } else {
        // Wait for one to finish
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return Array.from(this.statuses.values());
  }

  private async runNext(opts: OrchestratorOptions): Promise<void> {
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
          await this.sandbox.destroySandbox(workDir);
        } catch (e) {
          console.error(`Failed to destroy sandbox ${workDir}:`, e);
        }
      }
      
      // Try to run next if any left in queue
      if (this.queue.length > 0) {
        await this.runNext(opts);
      }
    }
  }
}
