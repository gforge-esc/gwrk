/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";

/**
 * Serializes a JavaScript value to canonical JSON.
 * - Object keys are sorted lexicographically by Unicode code point.
 * - Array element order is preserved.
 * - No whitespace between tokens.
 * - Primitives follow standard JSON serialization rules.
 */
export function toCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = value.map((item) => toCanonicalJson(item));
    return `[${elements.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

  const entries: string[] = [];
  for (const key of sortedKeys) {
    const val = obj[key];
    if (
      val !== undefined &&
      typeof val !== "function" &&
      typeof val !== "symbol"
    ) {
      entries.push(`${JSON.stringify(key)}:${toCanonicalJson(val)}`);
    }
  }

  return `{${entries.join(",")}}`;
}

/**
 * Computes the SHA-256 digest of the canonical JSON representation of a value.
 */
export function canonicalJsonSha256(value: unknown): string {
  return createHash("sha256")
    .update(toCanonicalJson(value), "utf8")
    .digest("hex");
}

/**
 * Parses JSON bytes/string and verifies that the raw representation
 * matches its canonical encoding exactly.
 *
 * This rejects:
 * - Duplicate keys (since JSON.parse collapses them, failing the round-trip equality check)
 * - Non-lexicographically-sorted keys
 * - Extraneous whitespace or non-standard token formatting
 * - Unknown trailing content (allows exactly one optional trailing newline \n)
 */
export function parseAndVerifyCanonicalJson<T = unknown>(
  raw: Buffer | string,
): T {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (withoutTrailingNewline.endsWith("\n")) {
    throw new Error(
      "Canonical JSON must not contain multiple trailing newlines",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutTrailingNewline);
  } catch (error) {
    throw new Error(`Malformed JSON: ${(error as Error).message}`);
  }

  const canonical = toCanonicalJson(parsed);
  if (withoutTrailingNewline !== canonical) {
    throw new Error(
      "Canonical JSON validation failed: input contains duplicate keys, unsorted keys, or non-canonical formatting",
    );
  }

  return parsed as T;
}
