-- Migration: 004-routing-history.sql
-- Create routing_history table to track backend selection for learning
-- Also ensuring routing_decisions table exists as per specifications.

CREATE TABLE IF NOT EXISTS routing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  outcome TEXT NOT NULL, -- 'success', 'failure', 'rate-limited', 'timeout'
  duration_ms INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

CREATE INDEX IF NOT EXISTS idx_routing_history_task_type ON routing_history(task_type);
CREATE INDEX IF NOT EXISTS idx_routing_history_selected_backend ON routing_history(selected_backend);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_run_id ON routing_decisions(run_id);
