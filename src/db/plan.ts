import type Database from "better-sqlite3";
import { getDb } from "./index.js";

export interface PlanFeature {
  id: string;
  name: string;
  status: string;
  sp_total: number;
  created_at?: string;
  updated_at?: string;
}

export interface PlanPhase {
  id: string;
  feature_id: string;
  name: string;
  status: string;
  health: string;
  sp_estimate: number;
  sp_actual?: number | null;
  duration_ms?: number | null;
  completed_at?: string | null;
  evidence?: string | null;
  seq: number;
  created_at?: string;
  updated_at?: string;
}

export interface PlanEdge {
  from_id: string;
  to_id: string;
  edge_type: string;
  created_at?: string;
}

export interface PlanProposal {
  id: string;
  target_phase_id: string;
  proposal_type: string;
  detail?: string | null;
  source?: string | null;
  status: string;
  created_at?: string;
  resolved_at?: string | null;
}

/**
 * Insert or replace a feature.
 */
export function insertFeature(
  feature: PlanFeature,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_features (id, name, status, sp_total, updated_at)
       VALUES (@id, @name, @status, @sp_total, datetime('now'))`,
    )
    .run(feature);
}

/**
 * Get a feature by ID.
 */
export function getFeature(
  id: string,
  db?: Database.Database,
): PlanFeature | undefined {
  const conn = db ?? getDb();
  return conn.prepare("SELECT * FROM plan_features WHERE id = ?").get(id) as
    | PlanFeature
    | undefined;
}

/**
 * List all features.
 */
export function listFeatures(db?: Database.Database): PlanFeature[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_features ORDER BY id ASC")
    .all() as PlanFeature[];
}

/**
 * Insert or replace a phase.
 */
export function insertPhase(phase: PlanPhase, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_phases (
         id, feature_id, name, status, health, sp_estimate,
         sp_actual, duration_ms, completed_at, evidence, seq, updated_at
       )
       VALUES (
         @id, @feature_id, @name, @status, @health, @sp_estimate,
         @sp_actual, @duration_ms, @completed_at, @evidence, @seq, datetime('now')
       )`,
    )
    .run({
      ...phase,
      sp_actual: phase.sp_actual ?? null,
      duration_ms: phase.duration_ms ?? null,
      completed_at: phase.completed_at ?? null,
      evidence: phase.evidence ?? null,
    });
}

/**
 * Get a phase by ID.
 */
export function getPhase(
  id: string,
  db?: Database.Database,
): PlanPhase | undefined {
  const conn = db ?? getDb();
  return conn.prepare("SELECT * FROM plan_phases WHERE id = ?").get(id) as
    | PlanPhase
    | undefined;
}

/**
 * List all phases for a feature.
 */
export function listPhases(
  featureId: string,
  db?: Database.Database,
): PlanPhase[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_phases WHERE feature_id = ? ORDER BY seq ASC")
    .all(featureId) as PlanPhase[];
}

/**
 * Insert or replace an edge.
 */
export function insertEdge(edge: PlanEdge, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_edges (from_id, to_id, edge_type)
       VALUES (@from_id, @to_id, @edge_type)`,
    )
    .run(edge);
}

/**
 * Get edges where the given ID is the 'to' node (dependencies).
 */
export function getEdgesForFeature(
  id: string,
  db?: Database.Database,
): PlanEdge[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_edges WHERE to_id = ?")
    .all(id) as PlanEdge[];
}

/**
 * List all edges.
 */
export function listAllEdges(db?: Database.Database): PlanEdge[] {
  const conn = db ?? getDb();
  return conn.prepare("SELECT * FROM plan_edges").all() as PlanEdge[];
}

/**
 * Recursively get all dependencies for a feature.
 */
export function getAllDependencies(
  id: string,
  db?: Database.Database,
): PlanFeature[] {
  const conn = db ?? getDb();
  return conn
    .prepare(`
      WITH RECURSIVE
        deps(feature_id) AS (
          SELECT from_id FROM plan_edges WHERE to_id = ? AND edge_type = 'DEPENDS_ON'
          UNION
          SELECT e.from_id
          FROM plan_edges e
          JOIN deps d ON e.to_id = d.feature_id
          WHERE e.edge_type = 'DEPENDS_ON'
        )
      SELECT f.* FROM plan_features f
      JOIN deps d ON f.id = d.feature_id
    `)
    .all(id) as PlanFeature[];
}

/**
 * Delete a phase.
 */
export function deletePhase(id: string, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare("DELETE FROM plan_phases WHERE id = ?").run(id);
}

/**
 * Delete a specific edge.
 */
export function deleteEdge(
  from_id: string,
  to_id: string,
  edge_type: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      "DELETE FROM plan_edges WHERE from_id = ? AND to_id = ? AND edge_type = ?",
    )
    .run(from_id, to_id, edge_type);
}

/**
 * Delete a feature and its phases/edges (cascade).
 */
export function deleteFeature(id: string, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn
    .prepare("DELETE FROM plan_edges WHERE from_id = ? OR to_id = ?")
    .run(id, id);
  conn.prepare("DELETE FROM plan_features WHERE id = ?").run(id);
}

/**
 * Check if the plan graph is empty.
 */
export function isPlanEmpty(db?: Database.Database): boolean {
  const conn = db ?? getDb();
  const result = conn
    .prepare("SELECT COUNT(*) as count FROM plan_features")
    .get() as { count: number };
  return result.count === 0;
}
