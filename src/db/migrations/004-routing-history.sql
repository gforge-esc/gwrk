-- Migration: 004-routing-history.sql
-- Create routing_history table to track backend selection for learning

CREATE TABLE IF NOT EXISTS routing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  outcome TEXT NOT NULL, -- 'success', 'failure', 'rate-limited', 'timeout'
  duration_ms INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_history_task_type ON routing_history(task_type);
CREATE INDEX IF NOT EXISTS idx_routing_history_selected_backend ON routing_history(selected_backend);
