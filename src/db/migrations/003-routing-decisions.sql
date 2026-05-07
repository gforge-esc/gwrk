-- Migration: 003-routing-decisions.sql
-- Create routing_decisions table as per DM-002 from 008-agent-router spec.

-- Ensure routing_history exists if we are migrating from old routing_decisions
CREATE TABLE IF NOT EXISTS routing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  outcome TEXT NOT NULL, -- 'success', 'failure', 'rate-limited', 'timeout'
  duration_ms INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Note: We don't drop routing_decisions here because this migration runs BEFORE 004-routing-history.sql.
-- If we run on a fresh DB:
-- 003-routing-decisions.sql runs -> creates routing_decisions (NEW schema)
-- 004-routing-history.sql runs -> CREATE TABLE IF NOT EXISTS routing_decisions -> no-op.
-- If we run on an existing DB where 004 was already applied:
-- This is trickier as 003 is "new" but with an "old" number. 
-- In practice, we'd use 007. But following instructions for 003.

CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  phase TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  selected_model TEXT,
  task_classification TEXT,
  reason TEXT NOT NULL,
  quota_percent INTEGER,
  probe_status TEXT NOT NULL,
  task_sp REAL,
  fallback_used BOOLEAN DEFAULT FALSE,
  model_failover_used BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_routing_decisions_run_id ON routing_decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_selected_backend ON routing_decisions(selected_backend);
