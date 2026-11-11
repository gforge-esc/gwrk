/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "./index.js";
import {
  canonicalProjectId,
  firstPerKey,
  projectScope,
} from "./project-registry.js";

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
 * Upsert a feature without cascading to its phases.
 */
export function insertFeature(
  feature: PlanFeature,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  const owner =
    getFeature(feature.id, projectId, conn)?.project_id ??
    canonicalProjectId(conn, projectId);
  conn
    .prepare(
      "INSERT INTO projects (id, name, path) VALUES (?, ?, '') ON CONFLICT(id) DO NOTHING",
    )
    .run(owner, owner);
  conn
    .prepare(
      `INSERT INTO plan_features (id, name, status, sp_total, project_id, updated_at)
       VALUES (@id, @name, @status, @sp_total, @project_id, datetime('now'))
       ON CONFLICT(project_id, id) DO UPDATE SET name = excluded.name,
         status = excluded.status, sp_total = excluded.sp_total, updated_at = excluded.updated_at`,
    )
    .run({ ...feature, project_id: owner });
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  return conn
    .prepare(`SELECT * FROM plan_features WHERE id = ? AND project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id LIMIT 1`)
    .get(id, ...ids, canonical) as PlanFeature | undefined;
}

/**
 * List all features.
 */
export function listFeatures(
  projectId: string,
  db?: Database.Database,
): PlanFeature[] {
  const conn = db ?? getDb();
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`SELECT * FROM plan_features WHERE project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id`)
    .all(...ids, canonical) as PlanFeature[];
  return firstPerKey(rows, (row) => row.id).sort((a, b) =>
    a.id < b.id ? -1 : Number(a.id > b.id),
  );
}

/**
 * Update a feature's status without triggering ON DELETE CASCADE.
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
    .run(status, id, getFeature(id, projectId, conn)?.project_id ?? projectId);
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
    .run(name, id, getFeature(id, projectId, conn)?.project_id ?? projectId);
}

/**
 * Update a feature's story-point total without triggering ON DELETE CASCADE.
 */
export function updateFeatureSpTotal(
  id: string,
  spTotal: number,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      "UPDATE plan_features SET sp_total = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    )
    .run(spTotal, id, getFeature(id, projectId, conn)?.project_id ?? projectId);
}

/**
 * Upsert a phase without cascading to its proposals.
 */
export function insertPhase(
  phase: PlanPhase,
  projectId: string,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .transaction(() => {
      const existing = getPhase(phase.id, projectId, conn);
      const parent = getFeature(phase.feature_id, projectId, conn);
      const owner =
        existing?.project_id ??
        parent?.project_id ??
        canonicalProjectId(conn, projectId);

      if (parent?.project_id && parent.project_id !== owner) {
        // Keep the phase and its proposals under their current foreign key owner.
        conn
          .prepare(`
        INSERT INTO plan_features (id, name, status, sp_total, created_at, updated_at, project_id)
        SELECT id, name, status, sp_total, created_at, updated_at, ?
        FROM plan_features WHERE id = ? AND project_id = ?
        ON CONFLICT(project_id, id) DO NOTHING
      `)
          .run(owner, phase.feature_id, parent.project_id);
      }

      conn
        .prepare(
          `INSERT INTO plan_phases (
           id, feature_id, name, status, health, sp_estimate,
           sp_actual, duration_ms, completed_at, evidence, seq, project_id, updated_at
         )
         VALUES (
           @id, @feature_id, @name, @status, @health, @sp_estimate,
           @sp_actual, @duration_ms, @completed_at, @evidence, @seq, @project_id, datetime('now')
         )
         ON CONFLICT(project_id, id) DO UPDATE SET feature_id = excluded.feature_id,
           name = excluded.name, status = excluded.status, health = excluded.health,
           sp_estimate = excluded.sp_estimate, sp_actual = excluded.sp_actual,
           duration_ms = excluded.duration_ms, completed_at = excluded.completed_at,
           evidence = excluded.evidence, seq = excluded.seq, updated_at = excluded.updated_at`,
        )
        .run({
          ...phase,
          project_id: owner,
          sp_actual: phase.sp_actual ?? null,
          duration_ms: phase.duration_ms ?? null,
          completed_at: phase.completed_at ?? null,
          evidence: phase.evidence ?? null,
        });
    })
    .immediate();
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  return conn
    .prepare(`SELECT * FROM plan_phases WHERE id = ? AND project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id LIMIT 1`)
    .get(id, ...ids, canonical) as PlanPhase | undefined;
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  return conn
    .prepare(`
      WITH ranked AS (
        SELECT rowid, feature_id, ROW_NUMBER() OVER (
          PARTITION BY id ORDER BY project_id = ? DESC, project_id
        ) AS rank
        FROM plan_phases WHERE project_id IN (${placeholders})
      )
      SELECT * FROM plan_phases
      WHERE rowid IN (SELECT rowid FROM ranked WHERE rank = 1 AND feature_id = ?)
      ORDER BY seq, id
    `)
    .all(canonical, ...ids, featureId) as PlanPhase[];
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
      `INSERT INTO plan_edges (from_id, to_id, edge_type, project_id)
       VALUES (@from_id, @to_id, @edge_type, @project_id)
       ON CONFLICT(project_id, from_id, to_id, edge_type) DO NOTHING`,
    )
    .run({ ...edge, project_id: canonicalProjectId(conn, projectId) });
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`SELECT * FROM plan_edges WHERE to_id = ? AND project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id`)
    .all(id, ...ids, canonical) as PlanEdge[];
  return firstPerKey(rows, (row) =>
    JSON.stringify([row.from_id, row.to_id, row.edge_type]),
  );
}

/**
 * List all edges.
 */
export function listAllEdges(
  projectId: string,
  db?: Database.Database,
): PlanEdge[] {
  const conn = db ?? getDb();
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`SELECT * FROM plan_edges WHERE project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id`)
    .all(...ids, canonical) as PlanEdge[];
  return firstPerKey(rows, (row) =>
    JSON.stringify([row.from_id, row.to_id, row.edge_type]),
  );
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(
      `
      WITH RECURSIVE
        scoped_edges AS (
          SELECT from_id, to_id FROM plan_edges
          WHERE project_id IN (${placeholders}) AND edge_type = 'DEPENDS_ON'
        ),
        deps(feature_id) AS (
          SELECT from_id FROM scoped_edges WHERE to_id = ?
          UNION
          SELECT e.from_id FROM scoped_edges e JOIN deps d ON e.to_id = d.feature_id
        )
      SELECT f.* FROM plan_features f
      JOIN deps d ON f.id = d.feature_id
      WHERE f.project_id IN (${placeholders})
      ORDER BY f.project_id = ? DESC, f.project_id
    `,
    )
    .all(...ids, id, ...ids, canonical) as PlanFeature[];
  return firstPerKey(rows, (row) => row.id);
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
    .transaction(() => {
      const existing = getProposal(proposal.id, projectId, conn);
      const { canonical, ids, placeholders } = projectScope(conn, projectId);
      const owner =
        getPhase(proposal.target_phase_id, projectId, conn)?.project_id ??
        canonical;

      conn
        .prepare(`
      INSERT INTO plan_proposals (
        id, target_phase_id, proposal_type, detail, source, status, project_id,
        created_at, resolved_at, updated_at
      ) VALUES (
        @id, @target_phase_id, @proposal_type, @detail, @source, @status, @project_id,
        COALESCE(@created_at, datetime('now')), @resolved_at, datetime('now')
      )
      ON CONFLICT(project_id, id) DO UPDATE SET target_phase_id = excluded.target_phase_id,
        proposal_type = excluded.proposal_type, detail = excluded.detail, source = excluded.source,
        status = excluded.status, created_at = excluded.created_at, resolved_at = excluded.resolved_at,
        updated_at = excluded.updated_at
    `)
        .run({
          ...proposal,
          project_id: owner,
          detail: proposal.detail ?? null,
          source: proposal.source ?? null,
          created_at: existing?.created_at ?? null,
          resolved_at: existing?.resolved_at ?? null,
        });

      conn
        .prepare(`
      DELETE FROM plan_proposals WHERE id = ? AND project_id IN (${placeholders})
        AND project_id <> ?
    `)
        .run(proposal.id, ...ids, owner);
    })
    .immediate();
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  return conn
    .prepare(`SELECT * FROM plan_proposals WHERE id = ? AND project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id LIMIT 1`)
    .get(id, ...ids, canonical) as PlanProposal | undefined;
}

/**
 * List all proposals.
 */
export function listProposals(
  projectId: string,
  db?: Database.Database,
): PlanProposal[] {
  const conn = db ?? getDb();
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`SELECT * FROM plan_proposals WHERE project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id`)
    .all(...ids, canonical) as PlanProposal[];
  return firstPerKey(rows, (row) => row.id).sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
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
  const { ids, placeholders } = projectScope(conn, projectId);
  conn
    .prepare(
      `DELETE FROM plan_proposals WHERE id = ? AND project_id IN (${placeholders})`,
    )
    .run(id, ...ids);
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
    .transaction(() => {
      const { ids, placeholders } = projectScope(conn, projectId);
      for (const proposal of listProposals(projectId, conn)) {
        if (proposal.target_phase_id === id)
          deleteProposal(proposal.id, projectId, conn);
      }
      conn
        .prepare(
          `DELETE FROM plan_phases WHERE id = ? AND project_id IN (${placeholders})`,
        )
        .run(id, ...ids);
    })
    .immediate();
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
  const { ids, placeholders } = projectScope(conn, projectId);
  conn
    .prepare(
      `DELETE FROM plan_edges WHERE from_id = ? AND to_id = ? AND edge_type = ? AND project_id IN (${placeholders})`,
    )
    .run(from_id, to_id, edge_type, ...ids);
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
    .transaction(() => {
      const { ids, placeholders } = projectScope(conn, projectId);
      const phases = listPhases(id, projectId, conn);
      const phaseIds = new Set(phases.map((phase) => phase.id));
      const cascades = conn.prepare(`
        SELECT 1 FROM plan_phases WHERE project_id = ? AND id = ? AND feature_id = ?
      `);
      const removeCopies = conn.prepare(`
        DELETE FROM plan_proposals
        WHERE id = ? AND project_id IN (${placeholders}) AND project_id <> ?
      `);
      const moveProposal = conn.prepare(`
        UPDATE plan_proposals SET project_id = ? WHERE id = ? AND project_id = ?
      `);
      for (const proposal of listProposals(projectId, conn)) {
        if (phaseIds.has(proposal.target_phase_id)) {
          deleteProposal(proposal.id, projectId, conn);
          continue;
        }
        if (!cascades.get(proposal.project_id, proposal.target_phase_id, id)) {
          continue;
        }
        const survivingPhase = getPhase(
          proposal.target_phase_id,
          projectId,
          conn,
        );
        if (survivingPhase) {
          removeCopies.run(proposal.id, ...ids, proposal.project_id);
          moveProposal.run(
            survivingPhase.project_id,
            proposal.id,
            proposal.project_id,
          );
        }
      }
      for (const phaseId of phaseIds) deletePhase(phaseId, projectId, conn);
      conn
        .prepare(
          `DELETE FROM plan_edges WHERE (from_id = ? OR to_id = ?) AND project_id IN (${placeholders})`,
        )
        .run(id, id, ...ids);
      conn
        .prepare(
          `DELETE FROM plan_features WHERE id = ? AND project_id IN (${placeholders})`,
        )
        .run(id, ...ids);
    })
    .immediate();
}

/**
 * Check if the plan graph is empty.
 */
export function isPlanEmpty(
  projectId: string,
  db?: Database.Database,
): boolean {
  const conn = db ?? getDb();
  const { ids, placeholders } = projectScope(conn, projectId);
  const result = conn
    .prepare(
      `SELECT COUNT(*) as count FROM plan_features WHERE project_id IN (${placeholders})`,
    )
    .get(...ids) as { count: number };
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
  const { ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(
      // exit_code = 0 is load-bearing. `plan init` promotes PLANNED → SHIPPED
      // from this set, so counting a run that DIED records work as shipped that
      // never landed — 005-dashboard-api/phase-07 was promoted off a run that
      // exited 1 on a transient GitHub error. `= 0` also excludes in-flight runs,
      // whose exit_code is still NULL.
      `SELECT DISTINCT feature_id, phase_id FROM runs
       WHERE command = 'ship' AND project_id IN (${placeholders}) AND exit_code = 0
       AND feature_id IS NOT NULL AND phase_id IS NOT NULL`,
    )
    .all(...ids) as { feature_id: string; phase_id: string }[];
  return new Set(rows.map((r) => `${r.feature_id}:${r.phase_id}`));
}
