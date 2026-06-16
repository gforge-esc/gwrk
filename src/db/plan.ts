/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "./index.js";

export interface PlanFeature {
  id: string;
  name: string;
  status: string;
  sp_total: number;
  project_id?: string;
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
  project_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PlanEdge {
  from_id: string;
  to_id: string;
  edge_type: string;
  project_id?: string;
  created_at?: string;
}

export interface PlanProposal {
  id: string;
  target_phase_id: string;
  proposal_type: string;
  detail?: string | null;
  source?: string | null;
  status: string;
  project_id?: string;
  created_at?: string;
  resolved_at?: string | null;
}

/**
 * Insert or replace a feature.
 */
export function insertFeature(
  feature: PlanFeature,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_features (id, name, status, sp_total, project_id, updated_at)
       VALUES (@id, @name, @status, @sp_total, @project_id, datetime('now'))`,
    )
    .run({ ...feature, project_id: projectId });
}

/**
 * Get a feature by ID.
 */
export function getFeature(
  id: string,
  projectId: string,
  db?: Database.Database,
): PlanFeature | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_features WHERE id = ? AND project_id = ?")
    .get(id, projectId) as PlanFeature | undefined;
}

/**
 * List all features.
 */
export function listFeatures(
  projectId: string,
  db?: Database.Database,
): PlanFeature[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_features WHERE project_id = ? ORDER BY id ASC")
    .all(projectId) as PlanFeature[];
}

/**
 * Update a feature's status without triggering ON DELETE CASCADE.
 * IMPORTANT: Do NOT use insertFeature() to update status — INSERT OR REPLACE
 * deletes the old row first, cascading to plan_phases.
 */
export function updateFeatureStatus(
  id: string,
  status: string,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      "UPDATE plan_features SET status = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    )
    .run(status, id, projectId);
}

/**
 * Update a feature's name without triggering ON DELETE CASCADE.
 */
export function updateFeatureName(
  id: string,
  name: string,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      "UPDATE plan_features SET name = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    )
    .run(name, id, projectId);
}

/**
 * Insert or replace a phase.
 */
export function insertPhase(
  phase: PlanPhase,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_phases (
         id, feature_id, name, status, health, sp_estimate,
         sp_actual, duration_ms, completed_at, evidence, seq, project_id, updated_at
       )
       VALUES (
         @id, @feature_id, @name, @status, @health, @sp_estimate,
         @sp_actual, @duration_ms, @completed_at, @evidence, @seq, @project_id, datetime('now')
       )`,
    )
    .run({
      ...phase,
      project_id: projectId,
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
  projectId: string,
  db?: Database.Database,
): PlanPhase | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_phases WHERE id = ? AND project_id = ?")
    .get(id, projectId) as PlanPhase | undefined;
}

/**
 * List all phases for a feature.
 */
export function listPhases(
  featureId: string,
  projectId: string,
  db?: Database.Database,
): PlanPhase[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM plan_phases WHERE feature_id = ? AND project_id = ? ORDER BY seq ASC",
    )
    .all(featureId, projectId) as PlanPhase[];
}

/**
 * Insert or replace an edge.
 */
export function insertEdge(
  edge: PlanEdge,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_edges (from_id, to_id, edge_type, project_id)
       VALUES (@from_id, @to_id, @edge_type, @project_id)`,
    )
    .run({ ...edge, project_id: projectId });
}

/**
 * Get edges where the given ID is the 'to' node (dependencies).
 */
export function getEdgesForFeature(
  id: string,
  projectId: string,
  db?: Database.Database,
): PlanEdge[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_edges WHERE to_id = ? AND project_id = ?")
    .all(id, projectId) as PlanEdge[];
}

/**
 * List all edges.
 */
export function listAllEdges(
  projectId: string,
  db?: Database.Database,
): PlanEdge[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_edges WHERE project_id = ?")
    .all(projectId) as PlanEdge[];
}

/**
 * Recursively get all dependencies for a feature.
 */
export function getAllDependencies(
  id: string,
  projectId: string,
  db?: Database.Database,
): PlanFeature[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      `
      WITH RECURSIVE
        deps(feature_id) AS (
          SELECT from_id FROM plan_edges WHERE to_id = ? AND project_id = ? AND edge_type = 'DEPENDS_ON'
          UNION
          SELECT e.from_id
          FROM plan_edges e
          JOIN deps d ON e.to_id = d.feature_id
          WHERE e.project_id = ? AND e.edge_type = 'DEPENDS_ON'
        )
      SELECT f.* FROM plan_features f
      JOIN deps d ON f.id = d.feature_id
      WHERE f.project_id = ?
    `,
    )
    .all(id, projectId, projectId, projectId) as PlanFeature[];
}

/**
 * Insert or replace a proposal.
 */
export function insertProposal(
  proposal: PlanProposal,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO plan_proposals (
         id, target_phase_id, proposal_type, detail, source, status, project_id, updated_at
       )
       VALUES (
         @id, @target_phase_id, @proposal_type, @detail, @source, @status, @project_id, datetime('now')
       )`,
    )
    .run({
      ...proposal,
      project_id: projectId,
      detail: proposal.detail ?? null,
      source: proposal.source ?? null,
    });
}

/**
 * Get a proposal by ID.
 */
export function getProposal(
  id: string,
  projectId: string,
  db?: Database.Database,
): PlanProposal | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM plan_proposals WHERE id = ? AND project_id = ?")
    .get(id, projectId) as PlanProposal | undefined;
}

/**
 * List all proposals.
 */
export function listProposals(
  projectId: string,
  db?: Database.Database,
): PlanProposal[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM plan_proposals WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as PlanProposal[];
}

/**
 * Delete a proposal.
 */
function deleteProposal(
  id: string,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare("DELETE FROM plan_proposals WHERE id = ? AND project_id = ?")
    .run(id, projectId);
}

/**
 * Delete a phase.
 */
export function deletePhase(
  id: string,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare("DELETE FROM plan_phases WHERE id = ? AND project_id = ?")
    .run(id, projectId);
}

/**
 * Delete a specific edge.
 */
export function deleteEdge(
  from_id: string,
  to_id: string,
  edge_type: string,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      "DELETE FROM plan_edges WHERE from_id = ? AND to_id = ? AND edge_type = ? AND project_id = ?",
    )
    .run(from_id, to_id, edge_type, projectId);
}

/**
 * Delete a feature and its phases/edges (cascade).
 */
export function deleteFeature(
  id: string,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      "DELETE FROM plan_edges WHERE (from_id = ? OR to_id = ?) AND project_id = ?",
    )
    .run(id, id, projectId);
  conn
    .prepare("DELETE FROM plan_features WHERE id = ? AND project_id = ?")
    .run(id, projectId);
}

/**
 * Check if the plan graph is empty.
 */
export function isPlanEmpty(
  projectId: string,
  db?: Database.Database,
): boolean {
  const conn = db ?? getDb();
  const result = conn
    .prepare("SELECT COUNT(*) as count FROM plan_features WHERE project_id = ?")
    .get(projectId) as { count: number };
  return result.count === 0;
}

/**
 * Query distinct shipped phases from the runs table.
 * Returns a Set of "featureId:phaseId" strings for O(1) lookup.
 */
export function getShippedPhases(
  projectId: string,
  db?: Database.Database,
): Set<string> {
  const conn = db ?? getDb();
  const rows = conn
    .prepare(
      `SELECT DISTINCT feature_id, phase_id FROM runs
       WHERE command = 'ship' AND project_id = ?
       AND feature_id IS NOT NULL AND phase_id IS NOT NULL`,
    )
    .all(projectId) as { feature_id: string; phase_id: string }[];
  return new Set(rows.map((r) => `${r.feature_id}:${r.phase_id}`));
}
