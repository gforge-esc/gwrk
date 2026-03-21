import type Database from "better-sqlite3";
import { getDb } from "./index.js";
import type { CompressionReport } from "../engine/types.js";

/**
 * DB record for compression metrics.
 * Snake_case to match SQL columns.
 */
export interface CompressionRecord {
  id?: number;
  feature_id: string;
  phase_id: string;
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
  recorded_at?: string;
}

/**
 * Record a compression report for a feature phase.
 */
export function recordCompression(
  report: CompressionReport,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  
  const record: CompressionRecord = {
    feature_id: report.featureId,
    phase_id: report.phaseId,
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
  };

  const result = conn
    .prepare(
      `INSERT INTO compression (
         feature_id, phase_id, estimated_hours, actual_coding_hours,
         estimated_days, actual_delivery_days, point_compression,
         total_compression, dormancy_days, first_impl_commit,
         merge_timestamp, session_count
       )
       VALUES (
         @feature_id, @phase_id, @estimated_hours, @actual_coding_hours,
         @estimated_days, @actual_delivery_days, @point_compression,
         @total_compression, @dormancy_days, @first_impl_commit,
         @merge_timestamp, @session_count
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
  db?: Database.Database,
): CompressionRecord | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM compression WHERE feature_id = ? AND phase_id = ?",
    )
    .get(featureId, phaseId) as CompressionRecord | undefined;
}

/**
 * List all compression records for a feature.
 */
export function listCompressionRecords(
  featureId: string,
  db?: Database.Database,
): CompressionRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM compression WHERE feature_id = ? ORDER BY recorded_at DESC")
    .all(featureId) as CompressionRecord[];
}
