/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { openDatabase } from "../../db/index.js";
import { createOperationsStore } from "../../db/operations.js";
import type { OperationsStorePort } from "../../ports/operations-port.js";
import { readLegacyDispatches } from "../../server/persistence.js";
import type { SqliteStoreOptions } from "./index.js";

export interface SqliteOperationsStoreOptions extends SqliteStoreOptions {
  close?: () => void;
}

export function createSqliteOperationsStoreAdapter(
  options: SqliteOperationsStoreOptions = {},
): OperationsStorePort {
  const { db, ...databaseOptions } = options;
  const connection = db ?? openDatabase(databaseOptions);
  return createOperationsStore(connection, {
    close: () => {
      if (!db && connection.open) connection.close();
      options.close?.();
    },
    readLegacyDispatches,
  });
}
