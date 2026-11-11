-- Disable foreign key actions while replacing parent tables.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE projects_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  github_repo TEXT,
  slack_channel TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  slug TEXT,
  repo_slug TEXT,
  trunk_branch TEXT NOT NULL DEFAULT 'develop',
  local_root TEXT,
  mirror_path TEXT,
  allowed_runners TEXT NOT NULL DEFAULT '["local"]',
  slack_workspace_id TEXT,
  slack_channel_name TEXT,
  slack_ops_channel_id TEXT,
  shared_channel INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

INSERT INTO projects_new (id, name, path, github_repo, slack_channel, created_at, slug)
SELECT id, name, path, github_repo, slack_channel, created_at, id FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

CREATE UNIQUE INDEX idx_projects_enrolled_slug ON projects(slug) WHERE updated_at IS NOT NULL;
CREATE UNIQUE INDEX idx_projects_enrolled_repo ON projects(repo_slug) WHERE updated_at IS NOT NULL;
CREATE INDEX idx_projects_slack_channel ON projects(slack_workspace_id, slack_channel);

CREATE TABLE project_aliases (
  alias_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_aliases_project ON project_aliases(project_id);

CREATE TABLE project_role_bindings (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('slack_user', 'cli_token', 'google_sub')),
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'maintainer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, principal_type, principal_id)
);

CREATE TABLE slack_feature_threads (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  root_ts TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, feature_id)
);

CREATE TABLE slack_action_receipts (
  receipt_key TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  phase_id TEXT,
  message_ts TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('claimed', 'executed', 'failed', 'uncertain')),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_slack_action_receipts_project ON slack_action_receipts(project_id);

-- Synthetic ship IDs never identified a specific run.
ALTER TABLE routing_decisions ADD COLUMN project_id TEXT;
UPDATE routing_decisions AS d SET project_id = COALESCE(
  (
    SELECT r.project_id FROM runs r
    WHERE r.id = CAST(d.run_id AS INTEGER) AND CAST(r.id AS TEXT) = d.run_id
      AND r.feature_id = d.feature AND r.phase_id = d.phase
  ),
  'legacy-local'
);
CREATE INDEX idx_routing_decisions_project_run ON routing_decisions(project_id, run_id);

INSERT OR IGNORE INTO projects (id, name, path, slug)
SELECT 'legacy-local', 'Legacy local records', '', 'legacy-local'
WHERE EXISTS (SELECT 1 FROM plan_features UNION ALL SELECT 1 FROM plan_phases
              UNION ALL SELECT 1 FROM plan_proposals UNION ALL SELECT 1 FROM plan_edges
              UNION ALL SELECT 1 FROM gate_results UNION ALL SELECT 1 FROM issues
              UNION ALL SELECT 1 FROM routing_decisions
              UNION ALL SELECT 1 FROM runs WHERE project_id IS NULL
              UNION ALL SELECT 1 FROM history WHERE project_id IS NULL
              UNION ALL SELECT 1 FROM compression WHERE project_id IS NULL
              UNION ALL SELECT 1 FROM routing_history WHERE project_id IS NULL);

INSERT OR IGNORE INTO projects (id, name, path, slug)
SELECT project_id, project_id, '', project_id
FROM (
  SELECT project_id FROM plan_features
  UNION SELECT project_id FROM plan_phases
  UNION SELECT project_id FROM plan_proposals
  UNION SELECT project_id FROM plan_edges
  UNION SELECT project_id FROM gate_results
  UNION SELECT project_id FROM issues
  UNION SELECT project_id FROM runs
  UNION SELECT project_id FROM history
)
WHERE project_id IS NOT NULL;

CREATE TABLE plan_features_new (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  sp_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (project_id, id)
);
INSERT INTO plan_features_new (id, name, status, sp_total, created_at, updated_at, project_id)
SELECT f.id, f.name, f.status, f.sp_total, f.created_at, f.updated_at, COALESCE(f.project_id, 'legacy-local')
FROM plan_features f;

CREATE TABLE plan_phases_new (
  id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  health TEXT NOT NULL DEFAULT 'CLEAN',
  sp_estimate INTEGER NOT NULL DEFAULT 0,
  sp_actual INTEGER,
  duration_ms INTEGER,
  completed_at TEXT,
  evidence TEXT,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, feature_id) REFERENCES plan_features(project_id, id) ON DELETE CASCADE
);
INSERT INTO plan_phases_new (id, feature_id, name, status, health, sp_estimate, sp_actual,
                            duration_ms, completed_at, evidence, seq, created_at, updated_at, project_id)
SELECT ph.id, ph.feature_id, ph.name, ph.status, ph.health, ph.sp_estimate, ph.sp_actual,
       ph.duration_ms, ph.completed_at, ph.evidence, ph.seq, ph.created_at, ph.updated_at,
       COALESCE(ph.project_id, f.project_id, 'legacy-local')
FROM plan_phases ph
LEFT JOIN plan_features_new f ON f.id = ph.feature_id;

CREATE TABLE plan_proposals_new (
  id TEXT NOT NULL,
  target_phase_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  detail TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  project_id TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, target_phase_id) REFERENCES plan_phases(project_id, id) ON DELETE CASCADE
);
INSERT INTO plan_proposals_new (id, target_phase_id, proposal_type, detail, source, status,
                               created_at, resolved_at, project_id)
SELECT pr.id, pr.target_phase_id, pr.proposal_type, pr.detail, pr.source, pr.status,
       pr.created_at, pr.resolved_at, COALESCE(pr.project_id, ph.project_id, 'legacy-local')
FROM plan_proposals pr
LEFT JOIN plan_phases_new ph ON ph.id = pr.target_phase_id;

-- Retain explicit child ownership without copying another project's data.
INSERT OR IGNORE INTO plan_phases_new (id, feature_id, name, seq, project_id)
SELECT pr.target_phase_id, COALESCE(ph.feature_id, pr.target_phase_id),
       pr.target_phase_id, 0, pr.project_id
FROM plan_proposals_new pr LEFT JOIN plan_phases ph ON ph.id = pr.target_phase_id;

INSERT OR IGNORE INTO plan_features_new (id, name, project_id)
SELECT feature_id, feature_id, project_id FROM plan_phases_new;

CREATE TABLE plan_edges_new (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  project_id TEXT NOT NULL,
  PRIMARY KEY (project_id, from_id, to_id, edge_type)
);
INSERT INTO plan_edges_new (from_id, to_id, edge_type, created_at, project_id)
SELECT e.from_id, e.to_id, e.edge_type, e.created_at,
       COALESCE(e.project_id, (
         SELECT MIN(f.project_id) FROM plan_features_new f
         WHERE f.id IN (e.from_id, e.to_id)
         HAVING COUNT(DISTINCT f.project_id) = 1
       ), 'legacy-local')
FROM plan_edges e;

CREATE TABLE gate_results_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  gate_script TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  output TEXT,
  recorded_at TEXT DEFAULT (datetime('now')),
  project_id TEXT NOT NULL,
  UNIQUE (project_id, feature_id, phase_id, task_id)
);
INSERT INTO gate_results_new (id, feature_id, phase_id, task_id, gate_script, passed,
                              exit_code, output, recorded_at, project_id)
SELECT g.id, g.feature_id, g.phase_id, g.task_id, g.gate_script, g.passed,
       g.exit_code, g.output, g.recorded_at,
       COALESCE(g.project_id, (
         SELECT MIN(project_id)
         FROM (
           SELECT ph.project_id FROM plan_phases_new ph
           WHERE ph.id = g.phase_id AND ph.feature_id = g.feature_id
           UNION ALL
           SELECT f.project_id FROM plan_features_new f WHERE f.id = g.feature_id
         )
         HAVING COUNT(DISTINCT project_id) = 1
       ), 'legacy-local')
FROM gate_results g;

CREATE TABLE issues_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number INTEGER NOT NULL,
  feature_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  html_url TEXT,
  created_at DATETIME NOT NULL,
  closed_at DATETIME,
  author TEXT NOT NULL,
  project_id TEXT NOT NULL,
  UNIQUE (project_id, issue_number)
);
INSERT INTO issues_new (id, issue_number, feature_id, title, body, state, html_url,
                        created_at, closed_at, author, project_id)
SELECT i.id, i.issue_number, i.feature_id, i.title, i.body, i.state, i.html_url,
       i.created_at, i.closed_at, i.author,
       COALESCE(i.project_id, (
         SELECT MIN(f.project_id) FROM plan_features_new f WHERE f.id = i.feature_id
         HAVING COUNT(DISTINCT f.project_id) = 1
       ), 'legacy-local')
FROM issues i;

UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
  (SELECT old.seq FROM sqlite_sequence old WHERE old.name = replace(sqlite_sequence.name, '_new', '')), 0))
WHERE name IN ('gate_results_new', 'issues_new');

DROP TABLE plan_proposals;
DROP TABLE plan_phases;
DROP TABLE plan_features;
DROP TABLE plan_edges;
DROP TABLE gate_results;
DROP TABLE issues;

ALTER TABLE plan_features_new RENAME TO plan_features;
ALTER TABLE plan_phases_new RENAME TO plan_phases;
ALTER TABLE plan_proposals_new RENAME TO plan_proposals;
ALTER TABLE plan_edges_new RENAME TO plan_edges;
ALTER TABLE gate_results_new RENAME TO gate_results;
ALTER TABLE issues_new RENAME TO issues;

CREATE INDEX idx_plan_phases_feature ON plan_phases(project_id, feature_id);
CREATE INDEX idx_plan_phases_status ON plan_phases(project_id, status);
CREATE INDEX idx_plan_proposals_phase ON plan_proposals(project_id, target_phase_id);
CREATE INDEX idx_plan_proposals_status ON plan_proposals(project_id, status);
CREATE INDEX idx_plan_edges_to ON plan_edges(project_id, to_id);
CREATE INDEX idx_issues_feature ON issues(project_id, feature_id);

-- Preserve orphaned run IDs without linking history to a different run.
ALTER TABLE history ADD COLUMN legacy_run_id INTEGER;
UPDATE history SET legacy_run_id = run_id, run_id = NULL
WHERE run_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM runs WHERE runs.id = history.run_id
);

UPDATE runs SET project_id = 'legacy-local' WHERE project_id IS NULL;
UPDATE history SET project_id = COALESCE(
  (SELECT r.project_id FROM runs r WHERE r.id = history.run_id),
  'legacy-local'
)
WHERE project_id IS NULL;

-- Ownerless reports can share a feature and phase. Preserve those rows while
-- retaining idempotent writes for attributed reports.
ALTER TABLE compression ADD COLUMN legacy_unattributed INTEGER NOT NULL DEFAULT 0;
DROP INDEX idx_compression_unique;
UPDATE compression SET project_id = 'legacy-local', legacy_unattributed = 1
WHERE project_id IS NULL;
CREATE UNIQUE INDEX idx_compression_unique
  ON compression(feature_id, phase_id, project_id) WHERE legacy_unattributed = 0;
UPDATE routing_history SET project_id = 'legacy-local' WHERE project_id IS NULL;

CREATE TEMP TABLE migration_014_fk_guard (violations INTEGER CHECK (violations = 0));
INSERT INTO migration_014_fk_guard SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE migration_014_fk_guard;

COMMIT;
PRAGMA foreign_keys = ON;
