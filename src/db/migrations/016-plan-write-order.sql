/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

-- The migration runner skips each column already added by the expanded 015.
ALTER TABLE plan_phases ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_proposals ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;
