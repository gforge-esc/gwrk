-- This Source Code Form is subject to the terms of the Mozilla Public
-- License, v. 2.0. If a copy of the MPL was not distributed with this
-- file, You can obtain one at https://mozilla.org/MPL/2.0/.

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_metadata_key
  ON notification_outbox(client_metadata_key);
