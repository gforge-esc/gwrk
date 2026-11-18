/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "./index.js";

export function getBackendSuccessRate(backendName: string): number {
  try {
    const result = getDb()
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) AS successes
         FROM runs WHERE agent_backend = ?`,
      )
      .get(backendName) as { total: number; successes: number };
    return result.total === 0 ? 0 : result.successes / result.total;
  } catch {
    return 0;
  }
}

interface AgentContextSync {
  project_root: string;
  backend_name: string;
  last_sync_at: string;
  context_hash: string;
}

/**
 * Get the last sync state for a project and backend.
 */
export function getAgentContextSync(
  projectRoot: string,
  backendName: string,
  db?: Database.Database,
): AgentContextSync | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM agent_context_sync WHERE project_root = ? AND backend_name = ?",
    )
    .get(projectRoot, backendName) as AgentContextSync | undefined;
}

/**
 * Record a successful context synchronization.
 */
export function recordAgentContextSync(
  sync: AgentContextSync,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO agent_context_sync (project_root, backend_name, last_sync_at, context_hash)
       VALUES (@project_root, @backend_name, datetime('now'), @context_hash)`,
    )
    .run({
      project_root: sync.project_root,
      backend_name: sync.backend_name,
      context_hash: sync.context_hash,
    });
}

interface RoutingDecision {
  task_type: string;
  selected_backend: string;
  outcome: "success" | "failure" | "rate-limited" | "timeout";
  duration_ms?: number;
  error_message?: string;
  project_id?: string;
}

/**
 * Record a routing decision for learning.
 */
export function recordRoutingDecision(
  decision: RoutingDecision,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT INTO routing_history (task_type, selected_backend, outcome, duration_ms, error_message, project_id)
       VALUES (@task_type, @selected_backend, @outcome, @duration_ms, @error_message, @project_id)`,
    )
    .run({
      ...decision,
      project_id: projectId,
      duration_ms: decision.duration_ms ?? null,
      error_message: decision.error_message ?? null,
    });
}

/**
 * Get routing history for a task type.
 */
export function getRoutingHistory(
  taskType: string,
  projectId: string,
  limit = 10,
  db?: Database.Database,
): RoutingDecision[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM routing_history WHERE task_type = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(taskType, projectId, limit) as RoutingDecision[];
}
