-- plan_features (DM-018-001)
CREATE TABLE IF NOT EXISTS plan_features (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PLANNED',
  sp_total    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- plan_phases (DM-018-002)
CREATE TABLE IF NOT EXISTS plan_phases (
  id            TEXT PRIMARY KEY,
  feature_id    TEXT NOT NULL REFERENCES plan_features(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PLANNED',
  health        TEXT NOT NULL DEFAULT 'CLEAN',
  sp_estimate   INTEGER NOT NULL DEFAULT 0,
  sp_actual     INTEGER,
  duration_ms   INTEGER,
  completed_at  TEXT,
  evidence      TEXT,
  seq           INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_phases_feature ON plan_phases(feature_id);
CREATE INDEX IF NOT EXISTS idx_plan_phases_status ON plan_phases(status);

-- plan_edges (DM-018-003)
CREATE TABLE IF NOT EXISTS plan_edges (
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  edge_type   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_plan_edges_from ON plan_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_to ON plan_edges(to_id);

-- plan_proposals (DM-018-004)
CREATE TABLE IF NOT EXISTS plan_proposals (
  id                TEXT PRIMARY KEY,
  target_phase_id   TEXT NOT NULL REFERENCES plan_phases(id),
  proposal_type     TEXT NOT NULL,
  detail            TEXT,
  source            TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_plan_proposals_phase ON plan_proposals(target_phase_id);
CREATE INDEX IF NOT EXISTS idx_plan_proposals_status ON plan_proposals(status);
