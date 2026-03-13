import { getDb } from "./index.js";
/**
 * Start a new run record. Returns the run ID.
 */
export function startRun(run, db) {
    const conn = db ?? getDb();
    const result = conn
        .prepare(`INSERT INTO runs (feature_id, phase_id, command, agent_backend, workflow)
       VALUES (@feature_id, @phase_id, @command, @agent_backend, @workflow)`)
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
export function finishRun(runId, update, db) {
    const conn = db ?? getDb();
    conn
        .prepare(`UPDATE runs SET
         finished_at = datetime('now'),
         exit_code = @exit_code,
         duration_s = @duration_s,
         gate_result = @gate_result,
         review_verdict = @review_verdict
       WHERE id = @id`)
        .run({
        id: runId,
        exit_code: update.exit_code ?? null,
        duration_s: update.duration_s ?? null,
        gate_result: update.gate_result ?? null,
        review_verdict: update.review_verdict ?? null,
    });
}
/**
 * Record a complete run in a single call. Used by shell scripts via CLI.
 */
export function recordRun(run, db) {
    const conn = db ?? getDb();
    const result = conn
        .prepare(`INSERT INTO runs (
         feature_id, phase_id, project_id, command, agent_backend,
         model, workflow, attempt, exit_code, duration_s,
         gate_result, review_verdict, retry_reason,
         files_changed, lines_added, lines_deleted, log_file,
         finished_at
       )
       VALUES (
         @feature_id, @phase_id, @project_id, @command, @agent_backend,
         @model, @workflow, @attempt, @exit_code, @duration_s,
         @gate_result, @review_verdict, @retry_reason,
         @files_changed, @lines_added, @lines_deleted, @log_file,
         datetime('now')
       )`)
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
    });
    return Number(result.lastInsertRowid);
}
/**
 * List all runs for a feature, most recent first.
 */
export function listRuns(featureId, db) {
    const conn = db ?? getDb();
    return conn
        .prepare("SELECT * FROM runs WHERE feature_id = ? ORDER BY id DESC")
        .all(featureId);
}
/**
 * Register a project in the global DB. Upserts by path.
 */
export function registerProject(project, db) {
    const conn = db ?? getDb();
    conn
        .prepare(`INSERT OR REPLACE INTO projects (id, name, path, github_repo, slack_channel)
       VALUES (@id, @name, @path, @github_repo, @slack_channel)`)
        .run({
        id: project.id,
        name: project.name,
        path: project.path,
        github_repo: project.github_repo ?? null,
        slack_channel: project.slack_channel ?? null,
    });
}
/**
 * Get aggregate success rates and execution durations from completed runs.
 */
export function getStats(db) {
    const conn = db ?? getDb();
    return conn
        .prepare(`SELECT
         command,
         agent_backend,
         workflow,
         COUNT(*) as total_runs,
         SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as success_runs,
         AVG(duration_s) as avg_duration_s
       FROM runs
       WHERE exit_code IS NOT NULL
       GROUP BY command, agent_backend, workflow
       ORDER BY total_runs DESC`)
        .all();
}
/**
 * List all projects.
 */
export function listProjects(db) {
    const conn = db ?? getDb();
    return conn
        .prepare("SELECT * FROM projects ORDER BY created_at DESC")
        .all();
}
/**
 * Record a task status change in the history table.
 */
export function recordHistory(entry, db) {
    const conn = db ?? getDb();
    const result = conn
        .prepare(`INSERT INTO history (
         project_id, feature_id, task_id, from_status, to_status, run_id, metadata
       )
       VALUES (
         @project_id, @feature_id, @task_id, @from_status, @to_status, @run_id, @metadata
       )`)
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
