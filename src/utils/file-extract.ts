/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Extract file paths referenced in task titles/descriptions. Plans (including
 * gwrk's own `define tasks` output) wrap paths in markdown backticks and
 * trailing punctuation — `(`src/lib/db/auth.js`)` — which must be stripped or
 * the path fails extension matching and test discovery silently no-ops.
 */
export function extractFilePaths(text: string): string[] {
  const matches = text.matchAll(
    /(?:src|tests|docs|scripts|packages)\/[^\s"'`),]+/g,
  );
  const out: string[] = [];
  for (const m of matches) {
    const cleaned = m[0]
      .replace(/^[`'"]+/, "")
      .replace(/[`'".,;)]+$/, "")
      .trim();
    if (cleaned.length > 0) out.push(cleaned);
  }
  return out;
}
