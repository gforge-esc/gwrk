import type Database from "better-sqlite3";
import { getDb } from "./index.js";

/**
 * DB record for gate execution evidence.
 * Snake_case to match SQL columns.
 */
export interface GateResultRecord {
  id?: number;
  feature_id: string;
  phase_id: string;
  task_id: string;
  gate_script: string;
  passed: number; // 0 or 1
  exit_code: number;
  output: string;
  project_id?: string;
  recorded_at?: string;
}

/**
 * Record a gate result. Uses INSERT OR REPLACE for idempotency —
 * re-running gates updates the existing record.
 */
export function recordGateResult(
  result: Omit<GateResultRecord, "id" | "recorded_at">,
  projectId: string,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const stmt = conn.prepare(`
    INSERT OR REPLACE INTO gate_results (
      feature_id, phase_id, task_id, gate_script, passed, exit_code, output, project_id
    ) VALUES (
      @feature_id, @phase_id, @task_id, @gate_script, @passed, @exit_code, @output, @project_id
    )
  `);
  const res = stmt.run({ ...result, project_id: projectId });
  return Number(res.lastInsertRowid);
}

/**
 * Get all gate results for a feature/phase.
 */
export function getGateResults(
  featureId: string,
  phaseId: string,
  projectId: string,
  db?: Database.Database,
): GateResultRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM gate_results WHERE feature_id = ? AND phase_id = ? AND project_id = ? ORDER BY task_id",
    )
    .all(featureId, phaseId, projectId) as GateResultRecord[];
}

/**
 * Get a single gate result for a specific task.
 */
export function getGateResult(
  featureId: string,
  phaseId: string,
  taskId: string,
  projectId: string,
  db?: Database.Database,
): GateResultRecord | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM gate_results WHERE feature_id = ? AND phase_id = ? AND task_id = ? AND project_id = ?",
    )
    .get(featureId, phaseId, taskId, projectId) as
    | GateResultRecord
    | undefined;
}

/**
 * Get all gate results for a feature (all phases).
 */
export function getAllGateResults(
  featureId: string,
  projectId: string,
  db?: Database.Database,
): GateResultRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM gate_results WHERE feature_id = ? AND project_id = ? ORDER BY phase_id, task_id",
    )
    .all(featureId, projectId) as GateResultRecord[];
}

