/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "./index.js";
import { firstPerKey, projectScope } from "./project-registry.js";

const gateResultColumns =
  "id, feature_id, phase_id, task_id, gate_script, passed, exit_code, output, project_id, recorded_at";

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
 * Record or update the result of a gate.
 */
export function recordGateResult(
  result: Omit<GateResultRecord, "id" | "recorded_at">,
  projectId: string,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const stmt = conn.prepare(`
    INSERT INTO gate_results (
      feature_id, phase_id, task_id, gate_script, passed, exit_code, output, project_id
    ) VALUES (
      @feature_id, @phase_id, @task_id, @gate_script, @passed, @exit_code, @output,
      COALESCE((SELECT project_id FROM project_aliases WHERE alias_id = @project_id), @project_id)
    )
    ON CONFLICT(project_id, feature_id, phase_id, task_id) DO UPDATE SET
      gate_script = excluded.gate_script, passed = excluded.passed, exit_code = excluded.exit_code,
      output = excluded.output, recorded_at = excluded.recorded_at
    RETURNING id
  `);
  const res = stmt.get({
    ...result,
    project_id: projectId,
  }) as { id: number };
  return res.id;
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
  const { ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`SELECT ${gateResultColumns} FROM gate_results WHERE feature_id = ? AND phase_id = ? AND project_id IN (${placeholders})
      ORDER BY write_seq DESC, recorded_at DESC, id DESC`)
    .all(featureId, phaseId, ...ids) as GateResultRecord[];
  return firstPerKey(rows, (row) => row.task_id).sort((a, b) =>
    a.task_id.localeCompare(b.task_id),
  );
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
  const { ids, placeholders } = projectScope(conn, projectId);
  return conn
    .prepare(`SELECT ${gateResultColumns} FROM gate_results WHERE feature_id = ? AND phase_id = ? AND task_id = ? AND project_id IN (${placeholders})
      ORDER BY write_seq DESC, recorded_at DESC, id DESC LIMIT 1`)
    .get(featureId, phaseId, taskId, ...ids) as GateResultRecord | undefined;
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
  const { ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`SELECT ${gateResultColumns} FROM gate_results WHERE feature_id = ? AND project_id IN (${placeholders})
      ORDER BY write_seq DESC, recorded_at DESC, id DESC`)
    .all(featureId, ...ids) as GateResultRecord[];
  return firstPerKey(rows, (row) =>
    JSON.stringify([row.phase_id, row.task_id]),
  ).sort(
    (a, b) =>
      a.phase_id.localeCompare(b.phase_id) ||
      a.task_id.localeCompare(b.task_id),
  );
}
