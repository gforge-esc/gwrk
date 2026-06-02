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
  pr_number?: number;
  pr_url?: string;
  status?: string;
  merge_commit_sha?: string;
}

/**
 * Start a new run record. Returns the run ID.
 */
export function startRun(
  run: Pick<
    RunRecord,
    "feature_id" | "phase_id" | "command" | "agent_backend" | "workflow"
  >,
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
  update: Partial<
    Pick<
      RunRecord,
      | "exit_code"
      | "duration_s"
      | "gate_result"
      | "review_verdict"
      | "finished_at"
      | "status"
      | "merge_commit_sha"
    >
  >,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `UPDATE runs SET
         finished_at = COALESCE(@finished_at, datetime('now')),
         exit_code = @exit_code,
         duration_s = @duration_s,
         gate_result = @gate_result,
         review_verdict = @review_verdict,
         status = @status,
         merge_commit_sha = @merge_commit_sha
       WHERE id = @id`,
    )
    .run({
      id: runId,
      finished_at: update.finished_at ?? null,
      exit_code: update.exit_code ?? null,
      duration_s: update.duration_s ?? null,
      gate_result: update.gate_result ?? null,
      review_verdict: update.review_verdict ?? null,
      status: update.status ?? null,
      merge_commit_sha: update.merge_commit_sha ?? null,
    });
}

/**
 * Record a complete run in a single call. Used by shell scripts via CLI.
 */
export function recordRun(
  run: Omit<RunRecord, "id" | "started_at" | "finished_at"> & {
    finished_at?: string;
  },
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const result = conn
    .prepare(
      `INSERT INTO runs (
         feature_id, phase_id, project_id, command, agent_backend,
         model, workflow, attempt, exit_code, duration_s,
         gate_result, review_verdict, retry_reason,
         files_changed, lines_added, lines_deleted, log_file,
         pr_number, pr_url, status, merge_commit_sha,
         finished_at
       )
       VALUES (
         @feature_id, @phase_id, @project_id, @command, @agent_backend,
         @model, @workflow, @attempt, @exit_code, @duration_s,
         @gate_result, @review_verdict, @retry_reason,
         @files_changed, @lines_added, @lines_deleted, @log_file,
         @pr_number, @pr_url, @status, @merge_commit_sha,
         COALESCE(@finished_at, datetime('now'))
       )`,
    )
    .run({
      feature_id: run.feature_id,
      phase_id: run.phase_id ?? null,
      project_id: run.project_id ?? null,
      command: run.command,
      agent_backend: run.agent_backend ?? null,
      model: run.model ?? null,
      workflow: run.workflow ?? null,
      attempt: run.attempt ?? 1,
      exit_code: run.exit_code ?? null,
      duration_s: run.duration_s ?? null,
      gate_result: run.gate_result ?? null,
      review_verdict: run.review_verdict ?? null,
      retry_reason: run.retry_reason ?? null,
      files_changed: run.files_changed ?? null,
      lines_added: run.lines_added ?? null,
      lines_deleted: run.lines_deleted ?? null,
      log_file: run.log_file ?? null,
      pr_number: run.pr_number ?? null,
      pr_url: run.pr_url ?? null,
      status: run.status ?? null,
      merge_commit_sha: run.merge_commit_sha ?? null,
      finished_at: run.finished_at ?? null,
    });
  return Number(result.lastInsertRowid);
}

/**
 * List all runs for a feature, most recent first.
 */
export function listRuns(
  featureId: string,
  projectId?: string,
  db?: Database.Database,
): RunRecord[] {
  const conn = db ?? getDb();
  if (projectId) {
    return conn
      .prepare(
        "SELECT * FROM runs WHERE feature_id = ? AND (project_id = ? OR project_id IS NULL) ORDER BY id DESC",
      )
      .all(featureId, projectId) as RunRecord[];
  }
  return conn
    .prepare("SELECT * FROM runs WHERE feature_id = ? ORDER BY id DESC")
    .all(featureId) as RunRecord[];
}

/**
 * Find the most recent PR number for a feature (optionally filtered by phase).
 * Returns { pr_number, pr_url } or null if no PR found.
 */
export function findOpenPr(
  featureId: string,
  phaseId?: string,
  projectId?: string,
  db?: Database.Database,
): { pr_number: number; pr_url: string | null } | null {
  const conn = db ?? getDb();
  let query = "SELECT pr_number, pr_url FROM runs WHERE feature_id = ?";
  const args: any[] = [featureId];

  if (phaseId) {
    query += " AND phase_id = ?";
    args.push(phaseId);
  }
  if (projectId) {
    query += " AND project_id = ?";
    args.push(projectId);
  }

  query += " AND pr_number IS NOT NULL ORDER BY id DESC LIMIT 1";

  const row = conn.prepare(query).get(...args) as
    | { pr_number: number; pr_url: string | null }
    | undefined;
  return row ?? null;
}


export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  github_repo?: string | null;
  slack_channel?: string | null;
  created_at?: string;
}

/**
 * Register a project in the global DB. Upserts by path.
 */
export function registerProject(
  project: ProjectRecord,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO projects (id, name, path, github_repo, slack_channel)
       VALUES (@id, @name, @path, @github_repo, @slack_channel)`,
    )
    .run({
      id: project.id,
      name: project.name,
      path: project.path,
      github_repo: project.github_repo ?? null,
      slack_channel: project.slack_channel ?? null,
    });
}

export interface RunStats {
  command: string;
  agent_backend: string | null;
  workflow: string | null;
  total_runs: number;
  success_runs: number;
  avg_duration_s: number;
}

/**
 * Get aggregate success rates and execution durations from completed runs.
 */
export function getStats(
  projectId?: string,
  db?: Database.Database,
): RunStats[] {
  const conn = db ?? getDb();
  const query = projectId
    ? `SELECT
         command,
         agent_backend,
         workflow,
         COUNT(*) as total_runs,
         SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as success_runs,
         AVG(duration_s) as avg_duration_s
       FROM runs
       WHERE exit_code IS NOT NULL AND project_id = ?
       GROUP BY command, agent_backend, workflow
       ORDER BY total_runs DESC`
    : `SELECT
         command,
         agent_backend,
         workflow,
         COUNT(*) as total_runs,
         SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as success_runs,
         AVG(duration_s) as avg_duration_s
       FROM runs
       WHERE exit_code IS NOT NULL
       GROUP BY command, agent_backend, workflow
       ORDER BY total_runs DESC`;

  const args = projectId ? [projectId] : [];
  return conn.prepare(query).all(...args) as RunStats[];
}


/**
 * List all projects.
 */
export function listProjects(db?: Database.Database): ProjectRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as ProjectRecord[];
}

export interface HistoryRecord {
  id?: number;
  timestamp?: string;
  project_id?: string;
  feature_id: string;
  task_id?: string;
  from_status?: string;
  to_status?: string;
  run_id?: number;
  metadata?: string;
}

/**
 * Record a task status change in the history table.
 */
export function recordHistory(
  entry: HistoryRecord,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const result = conn
    .prepare(
      `INSERT INTO history (
         project_id, feature_id, task_id, from_status, to_status, run_id, metadata
       )
       VALUES (
         @project_id, @feature_id, @task_id, @from_status, @to_status, @run_id, @metadata
       )`,
    )
    .run({
      project_id: entry.project_id ?? null,
      feature_id: entry.feature_id,
      task_id: entry.task_id ?? null,
      from_status: entry.from_status ?? null,
      to_status: entry.to_status ?? null,
      run_id: entry.run_id ?? null,
      metadata: entry.metadata ?? null,
    });
  return Number(result.lastInsertRowid);
}
