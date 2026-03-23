-- Agent Context Sync Tracking
-- 004-agent-context.sql

CREATE TABLE IF NOT EXISTS agent_context_sync (
  project_root TEXT NOT NULL,
  backend_name TEXT NOT NULL,
  last_sync_at DATETIME NOT NULL,
  context_hash TEXT NOT NULL, -- Hash of .gwrk/agent-context.md at time of sync
  PRIMARY KEY (project_root, backend_name)
);
