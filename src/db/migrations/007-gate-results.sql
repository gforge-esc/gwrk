-- Gate evidence table — stores pass/fail results per task per phase.
-- Source of truth for "done done" verification.
-- Survives tasks.json regeneration (define tasks --force).

CREATE TABLE IF NOT EXISTS gate_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id    TEXT NOT NULL,
  phase_id      TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  gate_script   TEXT NOT NULL,
  passed        INTEGER NOT NULL DEFAULT 0,
  exit_code     INTEGER,
  output        TEXT,
  recorded_at   TEXT DEFAULT (datetime('now'))
);

-- Unique constraint: one result per task per phase per feature.
-- ON CONFLICT REPLACE means re-running gates updates the existing record.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_results_unique
  ON gate_results (feature_id, phase_id, task_id);
