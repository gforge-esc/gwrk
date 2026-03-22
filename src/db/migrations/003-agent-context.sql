-- Agent Context Sync and Routing Decisions
-- 004-agent-context.sql

-- Tracks the synchronization state of CLI context files (ADR-006 §2.2)
CREATE TABLE IF NOT EXISTS agent_context_sync (
  project_root TEXT NOT NULL,
  backend_name TEXT NOT NULL,
  last_sync_at DATETIME NOT NULL,
  context_hash TEXT NOT NULL, -- Hash of .gwrk/agent-context.md at time of sync
  PRIMARY KEY (project_root, backend_name)
);

-- Tracks how the router selected a backend for a given task (F014 Phase 4)
CREATE TABLE IF NOT EXISTS routing_decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  fallback_chain TEXT, -- JSON array of backends attempted
  decision_reason TEXT, -- e.g., "historical_success", "quota_limit"
  created_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_routing_task ON routing_decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_routing_feature ON routing_decisions(feature_id);
