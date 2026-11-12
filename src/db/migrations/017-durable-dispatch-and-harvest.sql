-- Add durable dispatch, harvest, delivery and outbox records.
CREATE TABLE IF NOT EXISTS dispatch_operations (
  operation_id     TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_key         TEXT NOT NULL,
  feature_id       TEXT NOT NULL,
  phase_id         TEXT NOT NULL,
  task_ids_json    TEXT NOT NULL DEFAULT '[]',
  backend          TEXT NOT NULL,
  branch_name      TEXT NOT NULL,
  trunk_branch     TEXT NOT NULL,
  recipient_json   TEXT,
  status           TEXT NOT NULL,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  lease_owner      TEXT,
  lease_epoch      INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  heartbeat_at     TEXT,
  pr_number        INTEGER,
  pr_url           TEXT,
  last_run_id      INTEGER REFERENCES runs(id),
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_operations_active_work_key
  ON dispatch_operations(project_id, work_key)
  WHERE status IN ('accepted', 'leased', 'running', 'reconciling');

CREATE INDEX IF NOT EXISTS idx_dispatch_operations_project_status
  ON dispatch_operations(project_id, status, created_at);

CREATE TABLE IF NOT EXISTS dispatch_attempts (
  operation_id   TEXT NOT NULL REFERENCES dispatch_operations(operation_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  lease_epoch    INTEGER NOT NULL,
  lease_owner    TEXT NOT NULL,
  backend        TEXT NOT NULL,
  status         TEXT NOT NULL,
  run_id         INTEGER REFERENCES runs(id),
  worktree_dir   TEXT,
  exit_code      INTEGER,
  error          TEXT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  PRIMARY KEY (operation_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS harvest_deliveries (
  source       TEXT NOT NULL,
  delivery_id  TEXT NOT NULL,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  repo_slug    TEXT,
  checkout_repo_slug TEXT,
  payload_digest TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  reason       TEXT,
  received_at  TEXT NOT NULL,
  PRIMARY KEY (source, delivery_id),
  UNIQUE (source, delivery_id, project_id)
);

CREATE TABLE IF NOT EXISTS harvest_cursors (
  project_id       TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  last_polled_at   TEXT NOT NULL,
  last_terminal_at TEXT,
  last_pr_number   INTEGER,
  last_error       TEXT
);

CREATE TABLE IF NOT EXISTS harvest_operations (
  operation_id      TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_key          TEXT NOT NULL,
  repo_slug         TEXT,
  head_repo_slug    TEXT,
  trunk_branch      TEXT NOT NULL,
  feature_id        TEXT NOT NULL,
  phase_id          TEXT,
  pr_number         INTEGER,
  pr_url            TEXT,
  head_branch       TEXT,
  expected_head_sha TEXT,
  terminal_event    TEXT NOT NULL,
  merge_commit_sha  TEXT,
  terminal_at       TEXT NOT NULL,
  recipient_json    TEXT,
  planned_slack_recipient_json TEXT,
  status            TEXT NOT NULL,
  lease_owner       TEXT,
  lease_epoch       INTEGER NOT NULL DEFAULT 0,
  lease_expires_at  TEXT,
  linked_run_id     INTEGER REFERENCES runs(id),
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT,
  UNIQUE (project_id, work_key),
  UNIQUE (project_id, operation_id)
);

CREATE TABLE IF NOT EXISTS harvest_delivery_operations (
  source        TEXT NOT NULL,
  delivery_id   TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  position      INTEGER NOT NULL CHECK (position >= 0),
  operation_id  TEXT NOT NULL,
  PRIMARY KEY (source, delivery_id, position),
  UNIQUE (source, delivery_id, operation_id),
  FOREIGN KEY (source, delivery_id, project_id)
    REFERENCES harvest_deliveries(source, delivery_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, operation_id)
    REFERENCES harvest_operations(project_id, operation_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS harvest_work_key_aliases (
  project_id    TEXT NOT NULL,
  work_key      TEXT NOT NULL,
  operation_id  TEXT NOT NULL,
  PRIMARY KEY (project_id, work_key),
  FOREIGN KEY (project_id, operation_id)
    REFERENCES harvest_operations(project_id, operation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_harvest_operations_project_pr
  ON harvest_operations(project_id, pr_number, created_at);

CREATE TABLE IF NOT EXISTS harvest_stage_receipts (
  operation_id  TEXT NOT NULL REFERENCES harvest_operations(operation_id) ON DELETE CASCADE,
  phase_key     TEXT NOT NULL,
  stage         TEXT NOT NULL,
  status        TEXT NOT NULL,
  lease_epoch   INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT,
  error         TEXT,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT,
  PRIMARY KEY (operation_id, phase_key, stage)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  outbox_id           TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dedupe_key          TEXT NOT NULL,
  owner_kind          TEXT NOT NULL,
  owner_operation_id  TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  feature_id          TEXT NOT NULL,
  phase_id            TEXT,
  recipient_json      TEXT NOT NULL,
  payload_json        TEXT NOT NULL,
  client_metadata_key TEXT NOT NULL,
  status              TEXT NOT NULL,
  workspace_id        TEXT,
  channel_id          TEXT,
  thread_ts           TEXT,
  message_ts          TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  delivered_at        TEXT,
  UNIQUE (project_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON notification_outbox(project_id, status, created_at);
