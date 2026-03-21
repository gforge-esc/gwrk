-- Compression and Harvest Tracking
-- 003-compression.sql

-- Finalization data for runs
ALTER TABLE runs ADD COLUMN status TEXT;
ALTER TABLE runs ADD COLUMN merge_commit_sha TEXT;

-- Compression engine records (FR-H06)
CREATE TABLE IF NOT EXISTS compression (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id          TEXT NOT NULL,
  phase_id            TEXT NOT NULL,
  estimated_hours     REAL NOT NULL,
  actual_coding_hours REAL NOT NULL,
  estimated_days      REAL NOT NULL,
  actual_delivery_days REAL NOT NULL,
  point_compression   REAL NOT NULL,
  total_compression   REAL NOT NULL,
  dormancy_days       REAL,
  first_impl_commit   TEXT,
  merge_timestamp     TEXT NOT NULL,
  session_count       INTEGER,
  recorded_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compression_feature ON compression(feature_id);
