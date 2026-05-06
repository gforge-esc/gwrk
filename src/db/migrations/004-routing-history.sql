-- Migration: 005-routing-history.sql
-- Create routing_decisions table to track backend selection for learning

CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  outcome TEXT NOT NULL, -- 'success', 'failure', 'rate-limited', 'timeout'
  duration_ms INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_decisions_task_type ON routing_decisions(task_type);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_selected_backend ON routing_decisions(selected_backend);
