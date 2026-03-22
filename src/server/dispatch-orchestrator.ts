import type { GwrkConfig, AgentBackendType } from "../utils/config.js";
import type { SandboxManager } from "./sandbox.js";
import type { InvocationStrategy } from "./backends/invocation-strategy.js";
import type { TaskRecord } from "./types.js";
import type { TaskResult } from "../utils/agent.js";

export interface DispatchPhaseOptions {
  featureId: string;
  phaseId: string;
  tasks: Array<{ id: string; prompt?: string; backend?: AgentBackendType }>;
  backend?: AgentBackendType;
  concurrency?: number;
}

class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.active--;
    if (this.queue.length > 0) {
      this.active++;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get activeCount(): number {
    return this.active;
  }
}

export class DispatchOrchestrator {
  private queueTimeoutMs = 3600000; // 1 hour default
  private semaphores: Map<string, Semaphore> = new Map();
  private maxRetries = 3;

  constructor(
    private config: GwrkConfig,
    private sandboxManager: SandboxManager,
    private invocationStrategy: InvocationStrategy
  ) {}

  private getSemaphore(backend: string): Semaphore {
    const key = backend === "codex-cloud" ? "cloud" : "local";
    if (!this.semaphores.has(key)) {
      const limit = key === "cloud" 
        ? this.config.parallelism.cloud.maxConcurrent 
        : this.config.parallelism.local.maxClones;
      this.semaphores.set(key, new Semaphore(limit));
    }
    return this.semaphores.get(key)!;
  }

  async dispatchPhase(options: DispatchPhaseOptions): Promise<TaskRecord[]> {
    const { featureId, phaseId, tasks, concurrency, backend: topBackend } = options;
    
    const taskRecords: TaskRecord[] = tasks.map(t => ({
      id: t.id,
      status: "pending",
      sandboxDir: "",
      backend: t.backend || topBackend || this.config.agents.implement,
    }));

    const startTime = Date.now();

    // Respect per-call concurrency limit if provided
    const localLimit = options.concurrency ?? Number.MAX_SAFE_INTEGER;
    const localSemaphore = new Semaphore(localLimit);

    const dispatchTask = async (taskRecord: TaskRecord): Promise<void> => {
      const globalSemaphore = this.getSemaphore(taskRecord.backend);
      
      // Wait for both slots
      await localSemaphore.acquire();
      try {
        await globalSemaphore.acquire();
        try {
          if (Date.now() - startTime > this.queueTimeoutMs) {
            taskRecord.status = "failed";
            taskRecord.error = "Agent capacity queue timeout";
            if (!(taskRecord as any).result) {
              (taskRecord as any).result = { stderr: "Agent capacity queue timeout", exitCode: 1 };
            }
            return;
          }

          taskRecord.status = "running";
          taskRecord.startedAt = new Date().toISOString();

          let attempts = 0;
          let success = false;

          while (attempts < this.maxRetries) {
            attempts++;
            let sandboxDir = "";
            try {
              sandboxDir = await this.sandboxManager.createSandbox({
                featureId,
                phaseId,
                taskId: taskRecord.id,
                backend: taskRecord.backend,
                projectRoot: process.cwd(),
              });
              taskRecord.sandboxDir = sandboxDir;

              const result = await this.invocationStrategy.invoke({
                taskId: taskRecord.id,
                featureId,
                phaseId,
                backend: taskRecord.backend,
                workDir: sandboxDir,
                prompt: tasks.find(t => t.id === taskRecord.id)?.prompt,
              });

              success = result.exitCode === 0;
              taskRecord.exitCode = result.exitCode;
              (taskRecord as any).result = result;

              if (success) {
                taskRecord.status = "completed";
                await this.sandboxManager.destroySandbox(sandboxDir, featureId);
                break;
              }

              // Check for 429 status or rate-limit message in stderr
              const isRateLimited = result.exitCode === 429 || 
                                  (result.stderr && /rate limit|429|too many requests/i.test(result.stderr));

              if (isRateLimited && attempts < this.maxRetries) {
                await this.sandboxManager.destroySandbox(sandboxDir, featureId);
                await this.throttle(taskRecord.backend, attempts);
                continue;
              }

              // Non-retryable error or max retries reached
              taskRecord.status = "failed";
              await this.sandboxManager.destroySandbox(sandboxDir, featureId);
              break;
            } catch (error: any) {
              taskRecord.status = "failed";
              taskRecord.error = error.message;
              if (sandboxDir) {
                await this.sandboxManager.destroySandbox(sandboxDir, featureId);
              }
              break; 
            }
          }

          taskRecord.completedAt = new Date().toISOString();
        } finally {
          globalSemaphore.release();
        }
      } finally {
        localSemaphore.release();
      }
    };

    // Note: concurrency option from DispatchPhaseOptions can override the backend limit if needed,
    // but for now we prioritize global resource gating per Invariants 2.
    // If concurrency is provided and is SMALLER than backend limit, we could use a per-call semaphore.
    
    const taskPromises = taskRecords.map(record => dispatchTask(record));
    await Promise.all(taskPromises);

    return taskRecords;
  }

  calculateConcurrencyLimit(backend: string): number {
    if (backend === "codex-cloud") {
      return this.config.parallelism.cloud.maxConcurrent;
    }
    return this.config.parallelism.local.maxClones;
  }

  async throttle(backend: string, attempt = 1): Promise<void> {
    const baseDelay = 1000 * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 500;
    await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
  }
}
