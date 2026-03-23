import type Database from "better-sqlite3";
import { getDb } from "./index.js";

export interface AgentContextSync {
  project_root: string;
  backend_name: string;
  last_sync_at: string;
  context_hash: string;
}

/**
 * Get the last sync state for a project and backend.
 */
export function getAgentContextSync(
  projectRoot: string,
  backendName: string,
  db?: Database.Database,
): AgentContextSync | undefined {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM agent_context_sync WHERE project_root = ? AND backend_name = ?",
    )
    .get(projectRoot, backendName) as AgentContextSync | undefined;
}

/**
 * Record a successful context synchronization.
 */
export function recordAgentContextSync(
  sync: AgentContextSync,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn
    .prepare(
      `INSERT OR REPLACE INTO agent_context_sync (project_root, backend_name, last_sync_at, context_hash)
       VALUES (@project_root, @backend_name, datetime('now'), @context_hash)`,
    )
    .run({
      project_root: sync.project_root,
      backend_name: sync.backend_name,
      context_hash: sync.context_hash,
    });
}
