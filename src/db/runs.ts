import type Database from "better-sqlite3";
import { getDb } from "./index.js";

export interface RunRecord {
  id?: number;
  feature_id: string;
  phase_id?: string;
  project_id?: string;
  command: string;
  agent_backend?: string;
  model?: string;
  workflow?: string;
  attempt?: number;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
  duration_s?: number;
  gate_result?: string;
  review_verdict?: string;
  retry_reason?: string;
  files_changed?: number;
  lines_added?: number;
  lines_deleted?: number;
  log_file?: string;
}

/**
 * Start a new run record. Returns the run ID.
 */
export function startRun(
  run: Pick<RunRecord, "feature_id" | "phase_id" | "command" | "agent_backend" | "workflow">,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const result = conn
    .prepare(
      `INSERT INTO runs (feature_id, phase_id, command, agent_backend, workflow)
       VALUES (@feature_id, @phase_id, @command, @agent_backend, @workflow)`,
    )
    .run({
      feature_id: run.feature_id,
      phase_id: run.phase_id ?? null,
      command: run.command,
      agent_backend: run.agent_backend ?? null,
      workflow: run.workflow ?? null,
    });
  return Number(result.lastInsertRowid);
}

/**
 * Finish a run — record exit code, duration, and final status.
 */
export function finishRun(
  runId: number,
  update: Pick<RunRecord, "exit_code" | "duration_s" | "gate_result" | "review_verdict">,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `UPDATE runs SET
         finished_at = datetime('now'),
         exit_code = @exit_code,
         duration_s = @duration_s,
         gate_result = @gate_result,
         review_verdict = @review_verdict
       WHERE id = @id`,
    )
    .run({
      id: runId,
      exit_code: update.exit_code ?? null,
      duration_s: update.duration_s ?? null,
      gate_result: update.gate_result ?? null,
      review_verdict: update.review_verdict ?? null,
    });
}

/**
 * List all runs for a feature, most recent first.
 */
export function listRuns(featureId: string, db?: Database.Database): RunRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      `SELECT * FROM runs WHERE feature_id = ? ORDER BY id DESC`,
    )
    .all(featureId) as RunRecord[];
}

/**
 * Register a project in the global DB. Upserts by path.
 */
export function registerProject(
  project: { id: string; name: string; path: string; github_repo?: string },
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, github_repo)
       VALUES (@id, @name, @path, @github_repo)`,
    )
    .run({
      id: project.id,
      name: project.name,
      path: project.path,
      github_repo: project.github_repo ?? null,
    });
}

/**
 * List all projects.
 */
export function listProjects(db?: Database.Database) {
  const conn = db ?? getDb();
  return conn.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
}
