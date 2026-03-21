import type Database from "better-sqlite3";
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
export declare function startRun(run: Pick<RunRecord, "feature_id" | "phase_id" | "command" | "agent_backend" | "workflow">, db?: Database.Database): number;
/**
 * Finish a run — record exit code, duration, and final status.
 */
export declare function finishRun(runId: number, update: Partial<Pick<RunRecord, "exit_code" | "duration_s" | "gate_result" | "review_verdict" | "finished_at" | "status" | "merge_commit_sha">>, db?: Database.Database): void;
/**
 * Record a complete run in a single call. Used by shell scripts via CLI.
 */
export declare function recordRun(run: Omit<RunRecord, "id" | "started_at" | "finished_at"> & {
    finished_at?: string;
}, db?: Database.Database): number;
/**
 * List all runs for a feature, most recent first.
 */
export declare function listRuns(featureId: string, db?: Database.Database): RunRecord[];
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
export declare function registerProject(project: ProjectRecord, db?: Database.Database): void;
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
export declare function getStats(db?: Database.Database): RunStats[];
/**
 * List all projects.
 */
export declare function listProjects(db?: Database.Database): ProjectRecord[];
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
export declare function recordHistory(entry: HistoryRecord, db?: Database.Database): number;
