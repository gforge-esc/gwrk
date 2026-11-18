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

function isDispatchRecord(value: unknown): value is DispatchRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const requiredStrings = [
    "id",
    "featureId",
    "phaseId",
    "backend",
    "branchName",
    "createdAt",
  ];
  const statuses = ["queued", "running", "completed", "failed", "retrying"];
  return (
    requiredStrings.every((key) => {
      const field = record[key];
      return typeof field === "string" && field.trim().length > 0;
    }) &&
    typeof record.status === "string" &&
    statuses.includes(record.status) &&
    Array.isArray(record.attempts) &&
    Array.isArray(record.tasks)
  );
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
        const parsed: unknown = JSON.parse(trimmed);
        if (!isDispatchRecord(parsed)) continue;
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
