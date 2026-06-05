-- 010-backfill-project-id.sql
-- Backfill all NULL project_id rows to the host project.
-- gwrk is single-tenant. Stop treating project_id as optional.
--
-- The project_id for gwrk is derived from MD5(projectRoot).
-- Since SQLite doesn't have ALTER COLUMN to add NOT NULL to existing
-- columns, we enforce at the application layer via startRun/PlanStore.
-- This migration just backfills the data.

-- Backfill runs (the biggest table)
UPDATE runs SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

-- Backfill plan tables
UPDATE plan_features SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

UPDATE plan_phases SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

UPDATE plan_edges SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

-- Backfill gate_results
UPDATE gate_results SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

-- Backfill routing_history
UPDATE routing_history SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

-- Backfill compression
UPDATE compression SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

-- Backfill issues
UPDATE issues SET project_id = (
  SELECT id FROM projects WHERE name = 'gwrk' LIMIT 1
) WHERE project_id IS NULL;

-- Clean up test project junk from P10 init tests
DELETE FROM projects WHERE name LIKE 'gwrk-init-p10-test-%';
DELETE FROM projects WHERE name LIKE 'gwrk-test-%';
DELETE FROM projects WHERE name = 'temp_init_test';
DELETE FROM projects WHERE name LIKE 'repro-%';
