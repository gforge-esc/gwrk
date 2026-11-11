/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { recordCompression } from "../../db/compression.js";
import type { RunStorePort } from "../../ports/store-port.js";

export function createSqliteRunStoreAdapter(): RunStorePort {
  return {
    recordCompression: (report, projectId) =>
      recordCompression(report, projectId),
  };
}
