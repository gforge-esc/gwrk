/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { getDb } from "../db/index.js";

interface RoutingDecisionRecord {
  runId: string;
  feature: string;
  phase: string;
  selectedBackend: string;
  selectedModel?: string;
  taskClassification?: string;
  reason: string;
  quotaPercent?: number;
  probeStatus: string;
  taskSp?: number;
  fallbackUsed?: boolean;
  modelFailoverUsed?: boolean;
}

/**
 * Records a routing decision in the SQLite database for auditing and debugging.
 */
export function recordDecision(decision: RoutingDecisionRecord): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO routing_decisions (
      run_id,
      feature,
      phase,
      selected_backend,
      selected_model,
      task_classification,
      reason,
      quota_percent,
      probe_status,
      task_sp,
      fallback_used,
      model_failover_used
    ) VALUES (
      @runId,
      @feature,
      @phase,
      @selectedBackend,
      @selectedModel,
      @taskClassification,
      @reason,
      @quotaPercent,
      @probeStatus,
      @taskSp,
      @fallbackUsed,
      @modelFailoverUsed
    )
  `);

  stmt.run({
    ...decision,
    selectedModel: decision.selectedModel ?? null,
    taskClassification: decision.taskClassification ?? null,
    quotaPercent: decision.quotaPercent ?? null,
    taskSp: decision.taskSp ?? null,
    fallbackUsed: decision.fallbackUsed ? 1 : 0,
    modelFailoverUsed: decision.modelFailoverUsed ? 1 : 0,
  });
}
