/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

ALTER TABLE plan_features ADD COLUMN synthetic_parent INTEGER NOT NULL DEFAULT 0 CHECK (synthetic_parent IN (0, 1));
ALTER TABLE plan_phases ADD COLUMN synthetic_parent INTEGER NOT NULL DEFAULT 0 CHECK (synthetic_parent IN (0, 1));

-- The legacy schema allowed one real row per ID. Infer provenance only for
-- an untouched default-shaped parent with an independently saved counterpart.
-- The clock can move back one second before 014 records its applied time.
CREATE TABLE IF NOT EXISTS migration_014_plan_parent_provenance AS
WITH registry_upgrade AS (
  SELECT applied_at FROM _migrations WHERE name = '014-project-registry-and-composite-keys.sql'
)
SELECT 'feature' AS kind, f.id, f.project_id
FROM plan_features f JOIN registry_upgrade m ON unixepoch(f.created_at) <= unixepoch(m.applied_at) + 1
WHERE f.updated_at = f.created_at
  AND f.write_seq = 0
  AND f.name = f.id
  AND f.status = 'PLANNED'
  AND f.sp_total = 0
  AND EXISTS (
    SELECT 1 FROM plan_phases ph WHERE ph.project_id = f.project_id AND ph.feature_id = f.id
  )
  AND EXISTS (
    SELECT 1 FROM plan_features saved
    WHERE saved.id = f.id AND saved.project_id <> f.project_id
      AND saved.write_seq = 0
      AND julianday(saved.created_at) <= julianday(f.created_at)
      AND (saved.name <> saved.id OR saved.status <> 'PLANNED' OR saved.sp_total <> 0)
  )
UNION ALL
SELECT 'phase', ph.id, ph.project_id
FROM plan_phases ph JOIN registry_upgrade m ON unixepoch(ph.created_at) <= unixepoch(m.applied_at) + 1
WHERE ph.updated_at = ph.created_at
  AND ph.write_seq = 0
  AND ph.name = ph.id
  AND ph.status = 'PLANNED'
  AND ph.health = 'CLEAN'
  AND ph.seq = 0
  AND ph.sp_estimate = 0
  AND ph.sp_actual IS NULL
  AND ph.duration_ms IS NULL
  AND ph.completed_at IS NULL
  AND ph.evidence IS NULL
  AND EXISTS (
    SELECT 1 FROM plan_proposals pr WHERE pr.project_id = ph.project_id AND pr.target_phase_id = ph.id
  )
  AND EXISTS (
    SELECT 1 FROM plan_phases saved
    WHERE saved.id = ph.id AND saved.project_id <> ph.project_id
      AND saved.write_seq = 0
      AND julianday(saved.created_at) <= julianday(ph.created_at)
      AND (saved.name <> saved.id OR saved.status <> 'PLANNED' OR saved.health <> 'CLEAN'
        OR saved.seq <> 0 OR saved.sp_estimate <> 0 OR saved.sp_actual IS NOT NULL
        OR saved.duration_ms IS NOT NULL OR saved.completed_at IS NOT NULL OR saved.evidence IS NOT NULL)
  );
UPDATE plan_features SET synthetic_parent = 1
WHERE (project_id, id) IN (
  SELECT project_id, id FROM migration_014_plan_parent_provenance WHERE kind = 'feature'
);
UPDATE plan_phases SET synthetic_parent = 1
WHERE (project_id, id) IN (
  SELECT project_id, id FROM migration_014_plan_parent_provenance WHERE kind = 'phase'
);
DROP TABLE migration_014_plan_parent_provenance;
