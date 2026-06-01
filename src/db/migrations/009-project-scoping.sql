-- 009-project-scoping.sql
-- Add project_id scoping to all tables that currently lack it.
-- This prevents cross-project pollution in the global DB (~/.gwrk/gwrk.db).
--
-- Tables affected:
--   plan_features, plan_phases, plan_edges, plan_proposals
--   gate_results, compression, issues, routing_history
--
-- Strategy: Add nullable TEXT column, create indexes.
-- Existing rows get NULL project_id (legacy sentinel).
-- New rows from `gwrk init` onward will populate project_id.

-- Build plan tables (006-build-plan.sql)
ALTER TABLE plan_features ADD COLUMN project_id TEXT;
ALTER TABLE plan_phases ADD COLUMN project_id TEXT;
ALTER TABLE plan_edges ADD COLUMN project_id TEXT;
ALTER TABLE plan_proposals ADD COLUMN project_id TEXT;

-- Gate results (007-gate-results.sql)
ALTER TABLE gate_results ADD COLUMN project_id TEXT;

-- Compression metrics (005-compression.sql)
ALTER TABLE compression ADD COLUMN project_id TEXT;

-- Issues (008-issues.sql)
ALTER TABLE issues ADD COLUMN project_id TEXT;

-- Routing history (003-routing-decisions.sql)
ALTER TABLE routing_history ADD COLUMN project_id TEXT;

-- Indexes for scoped queries
CREATE INDEX IF NOT EXISTS idx_plan_features_project ON plan_features(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_phases_project ON plan_phases(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_project ON plan_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_gate_results_project ON gate_results(project_id);
CREATE INDEX IF NOT EXISTS idx_compression_project ON compression(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_routing_history_project ON routing_history(project_id);
