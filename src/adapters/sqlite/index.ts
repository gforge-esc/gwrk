/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { writeFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import { recordCompression } from "../../db/compression.js";
import { type SqliteDatabaseOptions, openDatabase } from "../../db/index.js";
import { PlanStore } from "../../engine/plan-store.js";
import type { PlanStorePort, RunStorePort } from "../../ports/store-port.js";

export interface SqliteStoreOptions extends SqliteDatabaseOptions {
  db?: Database.Database;
}

export interface SqlitePlanStoreOptions extends SqliteStoreOptions {
  projectId: string;
}

export function createSqlitePlanStoreAdapter({
  projectId,
  db,
  ...options
}: SqlitePlanStoreOptions): PlanStorePort {
  const owned = db ? undefined : openDatabase(options);
  const store = new PlanStore(projectId, db ?? owned);
  return {
    async initFromSpecs(specsDir) {
      const result = store.initFromSpecs(specsDir);
      return {
        added: result.added.length,
        skipped: result.skipped.length,
        phases: result.phasesInserted,
      };
    },
    async renderToMarkdown(outputPath) {
      await writeFile(outputPath, await store.render(), "utf8");
    },
    close() {
      if (owned?.open) owned.close();
    },
  };
}

export function createSqliteRunStoreAdapter(
  options: SqliteStoreOptions = {},
): RunStorePort {
  const owned =
    !options.db && options.dbPath !== undefined
      ? openDatabase(options)
      : undefined;
  const connection = options.db ?? owned;
  return {
    recordCompression(report, projectId) {
      recordCompression(report, projectId, connection);
    },
    close() {
      if (owned?.open) owned.close();
    },
  };
}
