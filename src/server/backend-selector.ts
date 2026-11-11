/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { exitCli, logCliError } from "../adapters/cli/output-scope.js";
import { getDb } from "../db/index.js";
import type { AgentRegistry } from "../domain/agent-config.js";
import {
  type BackendQuotaSnapshot,
  selectAgentRoute,
} from "../domain/agent-routing.js";
import { classifyTask } from "../domain/types.js";
import type { QuotaProber, QuotaReading } from "./quota-prober.js";
import { recordDecision } from "./routing-decisions.js";

export interface TaskContext {
  runId: string;
  feature: string;
  phase: string;
  taskType: string;
  language: string;
  taskSP: number;
}

interface BackendSelection {
  backend: string;
  model: string;
  mode: "selected" | "provider-default";
  effort?: string;
  taskClassification: string;
  reason: string;
  quotaPercent: number;
  probeStatus: QuotaReading["status"];
  fallbackUsed: boolean;
  modelFailoverUsed: boolean;
}

export class BackendSelector {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly prober: QuotaProber,
  ) {}

  async selectBackend(context: TaskContext): Promise<BackendSelection> {
    const backends = Object.values(this.registry.backends);
    if (backends.length === 0) {
      logCliError("No backends in registry");
      exitCli(1);
    }

    const readings: Record<string, QuotaReading> = {};
    const quotas: Record<string, BackendQuotaSnapshot> = {};
    const cooledDownModels: Record<string, string[]> = {};
    const history = backends.map(({ name }) => ({
      backend: name,
      runs: 0,
      successRate: this.getSuccessRate(name),
    }));
    for (const backend of backends) {
      const { name } = backend;
      const reading = await this.prober.probeQuota(
        backend,
        this.registry.backends,
      );
      readings[name] = reading;
      quotas[name] = {
        percent: reading.percent,
        probeStatus:
          reading.status === "timeout-assumed-available"
            ? "optimistic"
            : reading.status === "cached"
              ? "cached"
              : "fresh",
      };
      const models = [
        "default",
        ...backend.models.flatMap((entry) =>
          entry.modelFlag ? [entry.name, entry.modelFlag] : [entry.name],
        ),
        ...(backend.reviewModel
          ? [backend.reviewModel, "review-model-override"]
          : []),
      ];
      cooledDownModels[name] = [...new Set(models)].filter((model) =>
        this.prober.isModelInCooldown(name, model),
      );
    }

    if (Object.values(quotas).every((reading) => reading.percent <= 0)) {
      logCliError("All backends quota-exhausted. Retry after reset.");
      exitCli(1);
    }

    let route: ReturnType<typeof selectAgentRoute>;
    try {
      route = selectAgentRoute(
        { type: context.taskType },
        {
          registry: this.registry,
          quotas,
          history,
          historyMode: "quota-tiebreak",
          cooledDownModels,
          maxBackendAttempts: 3,
        },
      );
    } catch (error) {
      logCliError(error instanceof Error ? error.message : String(error));
      exitCli(1);
    }

    const reading = readings[route.backend];
    const selection: BackendSelection = {
      ...route,
      taskClassification: classifyTask(context.taskType),
      reason: `quota: ${reading.percent}% (${reading.status}), model: ${route.reason}`,
      quotaPercent: reading.percent,
      probeStatus: reading.status,
    };
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
      modelFailoverUsed: selection.modelFailoverUsed,
    });
    return selection;
  }

  /**
   * Calculates historical success rate for a backend from the runs table.
   * Success = exit_code 0.
   */
  private getSuccessRate(backendName: string): number {
    try {
      const db = getDb();
      const result = db
        .prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as successes
        FROM runs 
        WHERE agent_backend = ?
      `)
        .get(backendName) as { total: number; successes: number } | undefined;

      if (!result || result.total === 0) return 0;
      return result.successes / result.total;
    } catch (error) {
      return 0; // Optimistic default or fail silent for tiebreaker
    }
  }
}
