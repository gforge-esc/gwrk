/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as path from "node:path";
import type { DispatchRecord } from "./types.js";

/**
 * Appends a dispatch record to the persistent .gwrk/dispatches.jsonl log in the project root.
 * Creates the directory and file if they do not exist.
 */
export function persistDispatch(
  record: DispatchRecord,
  projectRoot: string = process.cwd(),
): void {
  const gwrkDir = path.join(projectRoot, ".gwrk");
  const dispatchesFile = path.join(gwrkDir, "dispatches.jsonl");

  if (!fs.existsSync(gwrkDir)) {
    fs.mkdirSync(gwrkDir, { recursive: true });
  }

  const line = `${JSON.stringify(record)}\n`;
  fs.appendFileSync(dispatchesFile, line, "utf-8");
}

export interface LegacyDispatchRecord extends DispatchRecord {
  evidenceLevel: "legacy_unverified";
}

/**
 * Reads legacy .gwrk/dispatches.jsonl entries tagged with evidenceLevel: "legacy_unverified".
 * Does NOT mutate the filesystem or create directories if they do not exist.
 */
export function readLegacyDispatches(
  projectRoot: string = process.cwd(),
): LegacyDispatchRecord[] {
  const dispatchesFile = path.join(projectRoot, ".gwrk", "dispatches.jsonl");
  if (!fs.existsSync(dispatchesFile)) {
    return [];
  }

  try {
    const content = fs.readFileSync(dispatchesFile, "utf-8");
    const lines = content.split("\n");
    const records: LegacyDispatchRecord[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as DispatchRecord;
        records.push({
          ...parsed,
          evidenceLevel: "legacy_unverified",
        });
      } catch {
        // Skip malformed legacy records
      }
    }

    return records;
  } catch {
    return [];
  }
}
