/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

ALTER TABLE plan_features ADD COLUMN synthetic_parent INTEGER NOT NULL DEFAULT 0 CHECK (synthetic_parent IN (0, 1));
ALTER TABLE plan_phases ADD COLUMN synthetic_parent INTEGER NOT NULL DEFAULT 0 CHECK (synthetic_parent IN (0, 1));

-- A ledger already upgraded by an earlier migration 014 has no provenance to transfer.
CREATE TABLE IF NOT EXISTS migration_014_plan_parent_provenance (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (kind, project_id, id)
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
