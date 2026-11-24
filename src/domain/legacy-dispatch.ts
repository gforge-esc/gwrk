/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/. */

const requiredStrings = [
  "id",
  "featureId",
  "phaseId",
  "backend",
  "branchName",
] as const;
const statuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "retrying",
] as const;

export type LegacyDispatchPayload = Record<string, unknown> &
  Record<(typeof requiredStrings)[number], string> & {
    status: (typeof statuses)[number];
    attempts: unknown[];
  } & (
    | { createdAt: string; taskId: string }
    | { createdAt: string; tasks: unknown[] }
    | { createdAt?: string; taskId?: never; tasks?: never }
  );

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isLegacyDispatchPayload(
  value: unknown,
): value is LegacyDispatchPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    requiredStrings.every((key) => isNonblankString(record[key])) &&
    statuses.some((status) => status === record.status) &&
    Array.isArray(record.attempts) &&
    ((isNonblankString(record.createdAt) &&
      (isNonblankString(record.taskId) || Array.isArray(record.tasks))) ||
      (record.taskId === undefined &&
        record.tasks === undefined &&
        (record.createdAt === undefined || isNonblankString(record.createdAt))))
  );
}

export function decodeLegacyDispatchLine(
  line: string,
): LegacyDispatchPayload | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return isLegacyDispatchPayload(value) ? value : null;
}
