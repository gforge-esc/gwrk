import type { AgentBackendConfig, AgentRegistry } from "./agent-registry.js";
import type { QuotaProber, QuotaReading } from "./quota-prober.js";
import { ModelSelector } from "./model-selector.js";
import { classifyTask, TaskClassification } from "./task-classifier.js";
import { recordDecision } from "./routing-decisions.js";
import { getDb } from "../db/index.js";

export interface TaskContext {
  runId: string;
  feature: string;
  phase: string;
  taskType: string;
  language: string;
  taskSP: number;
}

export interface BackendSelection {
  backend: string;
  model: string;
  command: string;
  taskClassification: string;
  reason: string;
  quotaPercent: number;
  probeStatus: QuotaReading["status"];
  fallbackUsed: boolean;
  modelFailoverUsed: boolean;
}

export class BackendSelector {
  private registry: AgentRegistry;
  private prober: QuotaProber;
  private modelSelector: ModelSelector;

  constructor(registry: AgentRegistry, prober: QuotaProber) {
    this.registry = registry;
    this.prober = prober;
    this.modelSelector = new ModelSelector();
  }

  /**
   * Selects the best available backend and model for the given task.
   */
  async selectBackend(context: TaskContext): Promise<BackendSelection> {
    const classification = classifyTask(context.taskType);
    const backends = Object.values(this.registry.backends);

    if (backends.length === 0) {
      console.error("No backends in registry");
      process.exit(1);
    }

    // 1. Probe all backends
    const readings: Map<string, QuotaReading> = new Map();
    for (const backend of backends) {
      readings.set(backend.name, await this.prober.probeQuota(backend, this.registry.backends));
    }

    // 2. Filter available backends (quota > 0%)
    const availableBackends = backends.filter(b => {
      const reading = readings.get(b.name);
      return reading && reading.percent > 0;
    });

    if (availableBackends.length === 0) {
      console.error("All backends quota-exhausted — retry after reset");
      process.exit(1);
    }

    // 3. Sort by quota descending
    availableBackends.sort((a, b) => {
      const qA = readings.get(a.name)!.percent;
      const qB = readings.get(b.name)!.percent;
      
      // If within 20%, use tiebreaker
      if (Math.abs(qA - qB) <= 20) {
        const successA = this.getSuccessRate(a.name);
        const successB = this.getSuccessRate(b.name);
        if (successA !== successB) {
          return successB - successA;
        }
      }
      
      return qB - qA;
    });

    // 4. Provider Fallback Chain (FR-004 Level 2)
    const attempts = 0;
    const maxAttempts = Math.min(3, availableBackends.length);
    let lastError = "";

    for (let i = 0; i < maxAttempts; i++) {
      const backend = availableBackends[i];
      const reading = readings.get(backend.name)!;

      // 5. Model Selection (Dimension 2)
      const { model, modelFailoverUsed } = this.modelSelector.selectModel(
        backend,
        classification,
        context.taskType,
        this.prober
      );

      if (model) {
        const command = this.modelSelector.renderCommand(backend.command, model);
        const selection: BackendSelection = {
          backend: backend.name,
          model: model.name,
          command,
          taskClassification: classification,
          reason: `quota: ${reading.percent}% (${reading.status}), model: ${model.tier} tier`,
          quotaPercent: reading.percent,
          probeStatus: reading.status,
          fallbackUsed: i > 0,
          modelFailoverUsed
        };

        // Record decision
        recordDecision({
          runId: context.runId,
          feature: context.feature,
          phase: context.phase,
          selectedBackend: selection.backend,
          selectedModel: selection.model,
          taskClassification: selection.taskClassification,
          reason: selection.reason,
          quotaPercent: selection.quotaPercent,
          probeStatus: selection.probeStatus,
          taskSp: context.taskSP,
          fallbackUsed: selection.fallbackUsed,
          modelFailoverUsed: selection.modelFailoverUsed
        });

        return selection;
      }

      // If no model available (all in cooldown), continue to next provider
      lastError = `All models for '${backend.name}' in cooldown — provider failover`;
    }

    console.error(`Fallback chain exhausted after ${maxAttempts} attempts. ${lastError}`);
    process.exit(1);
  }

  /**
   * Calculates historical success rate for a backend from the runs table.
   * Success = exit_code 0.
   */
  private getSuccessRate(backendName: string): number {
    try {
      const db = getDb();
      const result = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as successes
        FROM runs 
        WHERE agent_backend = ?
      `).get(backendName) as { total: number, successes: number } | undefined;

      if (!result || result.total === 0) return 0;
      return result.successes / result.total;
    } catch (error) {
      return 0; // Optimistic default or fail silent for tiebreaker
    }
  }
}
