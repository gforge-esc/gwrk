/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import type { CompressionReport } from "../engine/types.js";
import { getDb } from "./index.js";

/**
 * DB record for compression metrics.
 * Snake_case to match SQL columns.
 */
export interface CompressionRecord {
  id?: number;
  feature_id: string;
  phase_id?: string;
  estimated_hours: number;
  actual_coding_hours: number;
  estimated_days: number;
  actual_delivery_days: number;
  point_compression: number;
  total_compression: number;
  dormancy_days?: number;
  first_impl_commit?: string;
  merge_timestamp: string;
  session_count?: number;
  project_id?: string;
  recorded_at?: string;
  // Leading Indicators
  convergence_first_pass_rate?: number;
  convergence_avg_attempts?: number;
  density_lines_per_sp?: number;
  density_files_per_sp?: number;
  density_tool_calls_per_sp?: number;
  spec_quality_contract_count?: number;
  spec_quality_gate_count?: number;
}

/**
 * Record a compression report for a feature phase.
 */
export function recordCompression(
  report: CompressionReport,
  projectId: string,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();

  const record: CompressionRecord = {
    feature_id: report.featureId,
    phase_id: report.phaseId || "all",
    estimated_hours: report.forecast.estimatedHours,
    actual_coding_hours: report.actuals.activeCodingMinutes / 60,
    estimated_days: report.forecast.estimatedDays,
    actual_delivery_days: report.actuals.deliveryWindowHours / 24,
    point_compression: report.compression.pointCompression,
    total_compression: report.compression.totalCompression,
    dormancy_days: report.compression.dormancyDays,
    first_impl_commit: report.actuals.firstImplCommit,
    merge_timestamp: report.actuals.prMergedAt,
    session_count: report.actuals.sessionCount,
    project_id: projectId,
    // Indicators
    convergence_first_pass_rate: report.indicators?.convergence.firstPassRate,
    convergence_avg_attempts: report.indicators?.convergence.avgAttempts,
    density_lines_per_sp: report.indicators?.density.linesPerSP,
    density_files_per_sp: report.indicators?.density.filesPerSP,
    density_tool_calls_per_sp: report.indicators?.density.toolCallsPerSP,
    spec_quality_contract_count: report.indicators?.specQuality.contractCount,
    spec_quality_gate_count: report.indicators?.specQuality.gateCount,
  };

  const result = conn
    .prepare(
      `INSERT OR REPLACE INTO compression (
         feature_id, phase_id, estimated_hours, actual_coding_hours,
         estimated_days, actual_delivery_days, point_compression,
         total_compression, dormancy_days, first_impl_commit,
         merge_timestamp, session_count, project_id,
         convergence_first_pass_rate, convergence_avg_attempts,
         density_lines_per_sp, density_files_per_sp, density_tool_calls_per_sp,
         spec_quality_contract_count, spec_quality_gate_count
       )
       VALUES (
         @feature_id, @phase_id, @estimated_hours, @actual_coding_hours,
         @estimated_days, @actual_delivery_days, @point_compression,
         @total_compression, @dormancy_days, @first_impl_commit,
         @merge_timestamp, @session_count, @project_id,
         @convergence_first_pass_rate, @convergence_avg_attempts,
         @density_lines_per_sp, @density_files_per_sp, @density_tool_calls_per_sp,
         @spec_quality_contract_count, @spec_quality_gate_count
       )`,
    )
    .run(record);
  return Number(result.lastInsertRowid);
}

/**
 * Get the compression report for a feature phase.
 */
export function getCompressionRecord(
  featureId: string,
  phaseId: string,
  projectId: string,
  db?: Database.Database,
): CompressionRecord | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM compression WHERE feature_id = ? AND phase_id = ? AND project_id = ?",
    )
    .get(featureId, phaseId, projectId) as CompressionRecord | undefined;
}

/**
 * List all compression records for a feature.
 */
export function listCompressionRecords(
  featureId: string,
  projectId: string,
  db?: Database.Database,
): CompressionRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM compression WHERE feature_id = ? AND project_id = ? ORDER BY recorded_at DESC",
    )
    .all(featureId, projectId) as CompressionRecord[];
}
