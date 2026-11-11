/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import type Database from "better-sqlite3";
import { discoverGitIdentityFacts } from "../adapters/git/project-id.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import { getDb } from "./index.js";
import {
  canonicalProjectId,
  normalizeRegistryRepo,
  projectScope,
} from "./project-registry.js";

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
  device_id?: string;
  hostname?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
}

export interface RunTelemetrySummary {
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  costUsd: number;
  devices: string[];
}

/**
 * Start a new run record. Returns the run ID.
 */
function ensureProjectRow(
  conn: Database.Database,
  requestedProjectId?: string | null,
): string | null {
  if (requestedProjectId != null) {
    if (requestedProjectId === "") return null;
    const id = canonicalProjectId(conn, requestedProjectId);
    conn
      .prepare(
        "INSERT OR IGNORE INTO projects (id, name, path) VALUES (?, ?, '')",
      )
      .run(id, id);
    return id;
  }

  const { checkoutId, owner, origin, root } = resolveCheckoutOwner(
    conn,
    process.cwd(),
  );
  if (owner) return owner;

  conn
    .prepare(`
    INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET path = excluded.path, github_repo = excluded.github_repo
    WHERE projects.path = '' AND projects.github_repo IS NULL
  `)
    .run(checkoutId, path.basename(root), root, origin);
  return checkoutId;
}

function resolveCheckoutOwner(conn: Database.Database, root: string) {
  const facts = discoverGitIdentityFacts(root);
  const computedId = computeProjectId(facts);
  const checkoutId = canonicalProjectId(conn, computedId);
  const origin = normalizeRegistryRepo(facts.remoteOriginUrl ?? null);
  const findProject = conn.prepare<
    [string],
    {
      repo_slug: string | null;
      github_repo: string | null;
      updated_at: string | null;
    }
  >("SELECT repo_slug, github_repo, updated_at FROM projects WHERE id = ?");

  function storedRepos(id: string) {
    const row = findProject.get(id);
    return [row?.repo_slug, row?.github_repo]
      .map((repo) => normalizeRegistryRepo(repo ?? null))
      .filter((repo) => repo !== null);
  }

  function hasConflictingRepo(id: string): boolean {
    return storedRepos(id).some((repo) => repo !== origin);
  }

  if (
    hasConflictingRepo(computedId) ||
    hasConflictingRepo(checkoutId) ||
    (checkoutId !== computedId &&
      origin !== null &&
      !storedRepos(checkoutId).includes(origin))
  ) {
    throw new Error(`Project ownership conflict for checkout: ${root}`);
  }

  function checkoutScope(id: string): string[] {
    return projectScope(conn, id).ids.filter(
      (scopedId) => !hasConflictingRepo(scopedId),
    );
  }

  function resolved(owner?: string) {
    const ids = checkoutScope(checkoutId);
    if (owner && owner !== checkoutId) ids.push(...checkoutScope(owner));
    return { checkoutId, owner, origin, root: facts.projectRoot, ids };
  }

  if (findProject.get(checkoutId)?.updated_at != null) {
    return resolved(checkoutId);
  }

  function checkoutOwner(id: string): string | null {
    const owner = canonicalProjectId(conn, id);
    if (hasConflictingRepo(id) || hasConflictingRepo(owner)) return null;
    if (
      owner === checkoutId ||
      (origin !== null && storedRepos(owner).includes(origin))
    ) {
      return owner;
    }
    return origin === null && owner === id ? owner : null;
  }

  const atCheckout = conn
    .prepare(`
    SELECT id FROM projects WHERE path = @root OR local_root = @root OR mirror_path = @root
  `)
    .pluck()
    .all({ root: facts.projectRoot }) as string[];
  for (const id of computeLegacyProjectIds(facts)) {
    if (id === checkoutId || !atCheckout.includes(id)) continue;
    const owner = checkoutOwner(id);
    if (owner) return resolved(owner);
  }

  const owners = new Set(
    atCheckout.map(checkoutOwner).filter((id) => id !== null),
  );
  const [owner] = owners.size === 1 ? owners : [];
  return resolved(owner);
}

export function startRun(
  run: Pick<
    RunRecord,
    | "feature_id"
    | "phase_id"
    | "command"
    | "agent_backend"
    | "model"
    | "workflow"
    | "project_id"
    | "device_id"
    | "hostname"
  >,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const projectId = ensureProjectRow(conn, run.project_id);

  const result = conn
    .prepare(
      `INSERT INTO runs (
         feature_id, phase_id, project_id, command, agent_backend,
         model, workflow, device_id, hostname
       )
       VALUES (
         @feature_id, @phase_id, @project_id, @command, @agent_backend,
         @model, @workflow, @device_id, @hostname
       )`,
    )
    .run({
      feature_id: run.feature_id,
      phase_id: run.phase_id ?? null,
      project_id: projectId,
      command: run.command,
      agent_backend: run.agent_backend ?? null,
      model: run.model ?? null,
      workflow: run.workflow ?? null,
      device_id: run.device_id ?? null,
      hostname: run.hostname ?? null,
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
      | "pr_number"
      | "pr_url"
      | "files_changed"
      | "lines_added"
      | "lines_deleted"
      | "device_id"
      | "hostname"
      | "tokens_in"
      | "tokens_out"
      | "cost_usd"
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
         merge_commit_sha = @merge_commit_sha,
         pr_number = COALESCE(@pr_number, pr_number),
         pr_url = COALESCE(@pr_url, pr_url),
         files_changed = @files_changed,
         lines_added = @lines_added,
         lines_deleted = @lines_deleted,
         device_id = COALESCE(@device_id, device_id),
         hostname = COALESCE(@hostname, hostname),
         tokens_in = COALESCE(@tokens_in, tokens_in),
         tokens_out = COALESCE(@tokens_out, tokens_out),
         cost_usd = COALESCE(@cost_usd, cost_usd)
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
      pr_number: update.pr_number ?? null,
      pr_url: update.pr_url ?? null,
      files_changed: update.files_changed ?? null,
      lines_added: update.lines_added ?? null,
      lines_deleted: update.lines_deleted ?? null,
      device_id: update.device_id ?? null,
      hostname: update.hostname ?? null,
      tokens_in: update.tokens_in ?? null,
      tokens_out: update.tokens_out ?? null,
      cost_usd: update.cost_usd ?? null,
    });
}

/**
 * Record a complete run in a single call. Used by shell scripts via CLI.
 */
export function recordRun(
  run: Omit<RunRecord, "id" | "started_at" | "finished_at"> & {
    started_at?: string;
    finished_at?: string;
  },
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const projectId = run.project_id
    ? ensureProjectRow(conn, run.project_id)
    : null;
  const result = conn
    .prepare(
      `INSERT INTO runs (
         feature_id, phase_id, project_id, command, agent_backend,
         model, workflow, attempt, exit_code, duration_s,
         gate_result, review_verdict, retry_reason,
         files_changed, lines_added, lines_deleted, log_file,
         pr_number, pr_url, status, merge_commit_sha,
         device_id, hostname, tokens_in, tokens_out, cost_usd,
         started_at, finished_at
       )
       VALUES (
         @feature_id, @phase_id, @project_id, @command, @agent_backend,
         @model, @workflow, @attempt, @exit_code, @duration_s,
         @gate_result, @review_verdict, @retry_reason,
         @files_changed, @lines_added, @lines_deleted, @log_file,
         @pr_number, @pr_url, @status, @merge_commit_sha,
         @device_id, @hostname, @tokens_in, @tokens_out, @cost_usd,
         COALESCE(@started_at, datetime('now')), COALESCE(@finished_at, datetime('now'))
       )`,
    )
    .run({
      feature_id: run.feature_id,
      phase_id: run.phase_id ?? null,
      project_id: projectId,
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
      device_id: run.device_id ?? null,
      hostname: run.hostname ?? null,
      tokens_in: run.tokens_in ?? null,
      tokens_out: run.tokens_out ?? null,
      cost_usd: run.cost_usd ?? null,
      started_at: run.started_at ?? null,
      finished_at: run.finished_at ?? null,
    });
  return Number(result.lastInsertRowid);
}

/**
 * Aggregate token usage, USD cost, and workstation provenance for a feature/phase.
 */
export function getFeatureRunTelemetry(
  featureId: string,
  projectId: string,
  phaseId?: string,
  db?: Database.Database,
): RunTelemetrySummary {
  const conn = db ?? getDb();
  const { ids, placeholders } = projectScope(conn, projectId);
  let query = `SELECT tokens_in, tokens_out, cost_usd, device_id, hostname FROM runs WHERE feature_id = ? AND project_id IN (${placeholders})`;
  const args = [featureId, ...ids];

  if (phaseId) {
    query += " AND phase_id = ?";
    args.push(phaseId);
  }

  const rows = conn.prepare(query).all(...args) as Array<{
    tokens_in: number | null;
    tokens_out: number | null;
    cost_usd: number | null;
    device_id: string | null;
    hostname: string | null;
  }>;

  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  const deviceSet = new Set<string>();

  for (const row of rows) {
    tokensIn += row.tokens_in ?? 0;
    tokensOut += row.tokens_out ?? 0;
    costUsd += row.cost_usd ?? 0;
    if (row.device_id) {
      deviceSet.add(row.device_id);
    } else if (row.hostname) {
      deviceSet.add(row.hostname);
    }
  }

  return {
    tokensIn,
    tokensOut,
    totalTokens: tokensIn + tokensOut,
    costUsd,
    devices: Array.from(deviceSet).sort(),
  };
}

/**
 * List all runs for a feature, most recent first.
 */
export function listRuns(
  featureId: string,
  projectId: string,
  db?: Database.Database,
): RunRecord[] {
  const conn = db ?? getDb();
  return listRunsInScope(conn, featureId, projectScope(conn, projectId).ids);
}

export function listCheckoutRuns(
  featureId: string,
  checkout: string,
  db?: Database.Database,
): RunRecord[] {
  const conn = db ?? getDb();
  const { ids } = resolveCheckoutOwner(conn, checkout);
  return listRunsInScope(conn, featureId, ids);
}

function listRunsInScope(
  conn: Database.Database,
  featureId: string,
  ids: string[],
): RunRecord[] {
  const placeholders = ids.map(() => "?").join(", ");
  return conn
    .prepare(
      `SELECT * FROM runs WHERE feature_id = ? AND project_id IN (${placeholders}) ORDER BY id DESC`,
    )
    .all(featureId, ...ids) as RunRecord[];
}

/**
 * Find the most recent PR number for a feature (optionally filtered by phase).
 * Returns { pr_number, pr_url } or null if no PR found.
 */
export function findOpenPr(
  featureId: string,
  projectId: string,
  phaseId?: string,
  db?: Database.Database,
): { pr_number: number; pr_url: string | null } | null {
  const conn = db ?? getDb();
  const { ids, placeholders } = projectScope(conn, projectId);
  let query = `SELECT pr_number, pr_url FROM runs WHERE feature_id = ? AND project_id IN (${placeholders})`;
  const args = [featureId, ...ids];

  if (phaseId) {
    query += " AND phase_id = ?";
    args.push(phaseId);
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
 * Register a legacy project in the global DB. Upserts by ID.
 */
export function registerProject(
  project: ProjectRecord,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT INTO projects (id, name, path, github_repo, slack_channel)
       VALUES (@id, @name, @path, @github_repo, @slack_channel)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, path = excluded.path,
         github_repo = excluded.github_repo, slack_channel = excluded.slack_channel
       WHERE projects.updated_at IS NULL`,
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
  projectId: string,
  db?: Database.Database,
): RunStats[] {
  const conn = db ?? getDb();
  const { ids, placeholders } = projectScope(conn, projectId);
  const query = `SELECT
         command,
         agent_backend,
         workflow,
         COUNT(*) as total_runs,
         SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as success_runs,
         AVG(duration_s) as avg_duration_s
       FROM runs
       WHERE exit_code IS NOT NULL AND project_id IN (${placeholders})
       GROUP BY command, agent_backend, workflow
       ORDER BY total_runs DESC`;

  return conn.prepare(query).all(...ids) as RunStats[];
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
