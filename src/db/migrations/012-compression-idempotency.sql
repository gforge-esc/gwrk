-- 012-compression-idempotency.sql
-- Add unique constraint to compression table to enforce idempotency

CREATE UNIQUE INDEX IF NOT EXISTS idx_compression_unique ON compression(feature_id, phase_id, project_id);
