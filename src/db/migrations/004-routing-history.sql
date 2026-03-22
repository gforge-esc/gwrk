-- FR-014: Track routing decisions and historical success for the Routing Engine
CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,          -- e.g., 'implement', 'skill', 'research'
  skill_name TEXT,                  -- name of the skill if task_type is 'skill'
  backend_name TEXT NOT NULL,       -- the backend selected
  status TEXT NOT NULL,             -- 'success', 'failure', 'rate_limited'
  error_type TEXT,                  -- 'gate_failure', 'auth_error', etc.
  duration_ms INTEGER,              -- how long the task took
  token_usage_input INTEGER,
  token_usage_output INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_task ON routing_decisions(task_type, skill_name);
CREATE INDEX IF NOT EXISTS idx_routing_backend ON routing_decisions(backend_name, status);
