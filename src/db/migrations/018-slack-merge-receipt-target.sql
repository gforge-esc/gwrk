/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

ALTER TABLE slack_action_receipts ADD COLUMN merge_repository TEXT;
ALTER TABLE slack_action_receipts ADD COLUMN merge_pr_number INTEGER;
