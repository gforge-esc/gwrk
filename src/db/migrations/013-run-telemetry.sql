-- 013-run-telemetry.sql
-- Add workstation provenance and token/cost telemetry columns to runs table (038-telemetry-cost-ledger)

ALTER TABLE runs ADD COLUMN device_id TEXT;
ALTER TABLE runs ADD COLUMN hostname TEXT;
ALTER TABLE runs ADD COLUMN tokens_in INTEGER;
ALTER TABLE runs ADD COLUMN tokens_out INTEGER;
ALTER TABLE runs ADD COLUMN cost_usd REAL;
