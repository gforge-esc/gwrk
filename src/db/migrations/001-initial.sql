-- gwrk execution ledger — initial schema (ADR-002)
-- Global database: ~/.gwrk/gwrk.db

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  github_repo TEXT,
  slack_channel TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id      TEXT NOT NULL,
  phase_id        TEXT,
  project_id      TEXT REFERENCES projects(id),
  command         TEXT NOT NULL,
  agent_backend   TEXT,
  model           TEXT,
  workflow        TEXT,
  attempt         INTEGER NOT NULL DEFAULT 1,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  exit_code       INTEGER,
  duration_s      INTEGER,
  gate_result     TEXT,
  review_verdict  TEXT,
  retry_reason    TEXT,
  files_changed   INTEGER,
  lines_added     INTEGER,
  lines_deleted   INTEGER,
  log_file        TEXT
);

CREATE TABLE IF NOT EXISTS history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  project_id  TEXT REFERENCES projects(id),
  feature_id  TEXT NOT NULL,
  task_id     TEXT,
  from_status TEXT,
  to_status   TEXT,
  run_id      INTEGER REFERENCES runs(id),
  metadata    TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_feature ON runs(feature_id);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_history_feature ON history(feature_id);
