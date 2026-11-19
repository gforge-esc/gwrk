/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "../db/index.js";
import { canonicalProjectId, projectScope } from "../db/project-registry.js";

interface RoutingDecisionRecord {
  runId: string;
  projectId?: string;
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
export function recordDecision(
  decision: RoutingDecisionRecord,
  db: Database.Database = getDb(),
): void {
  const run =
    decision.projectId === undefined
      ? (db
          .prepare(`
        SELECT project_id FROM runs
        WHERE id = CAST(@runId AS INTEGER) AND CAST(id AS TEXT) = @runId
          AND feature_id = @feature AND phase_id = @phase
      `)
          .get(decision) as { project_id: string | null } | undefined)
      : undefined;
  const stmt = db.prepare(`
    INSERT INTO routing_decisions (
      run_id,
      project_id,
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
      @projectId,
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
    projectId: canonicalProjectId(
      db,
      decision.projectId ?? run?.project_id ?? "legacy-local",
    ),
    selectedModel: decision.selectedModel ?? null,
    taskClassification: decision.taskClassification ?? null,
    quotaPercent: decision.quotaPercent ?? null,
    taskSp: decision.taskSp ?? null,
    fallbackUsed: decision.fallbackUsed ? 1 : 0,
    modelFailoverUsed: decision.modelFailoverUsed ? 1 : 0,
  });
}

export function listRoutingDecisions(
  projectId: string,
  runId: string,
  db: Database.Database = getDb(),
): RoutingDecisionRecord[] {
  const { ids, placeholders } = projectScope(db, projectId);
  const rows = db
    .prepare(`
    SELECT run_id AS runId, project_id AS projectId, feature, phase, selected_backend AS selectedBackend,
      selected_model AS selectedModel, task_classification AS taskClassification, reason,
      quota_percent AS quotaPercent, probe_status AS probeStatus, task_sp AS taskSp,
      fallback_used AS fallbackUsed, model_failover_used AS modelFailoverUsed
    FROM routing_decisions WHERE project_id IN (${placeholders}) AND run_id = ? ORDER BY id
  `)
    .all(...ids, runId) as Array<
    Omit<RoutingDecisionRecord, "fallbackUsed" | "modelFailoverUsed"> & {
      fallbackUsed: number;
      modelFailoverUsed: number;
    }
  >;
  return rows.map((row) => ({
    ...row,
    selectedModel: row.selectedModel ?? undefined,
    taskClassification: row.taskClassification ?? undefined,
    quotaPercent: row.quotaPercent ?? undefined,
    taskSp: row.taskSp ?? undefined,
    fallbackUsed: row.fallbackUsed === 1,
    modelFailoverUsed: row.modelFailoverUsed === 1,
  }));
}
