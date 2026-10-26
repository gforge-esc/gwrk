/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type AdrAmendment,
  type AdrRecord,
  listSectionAddresses,
  parseRecord,
  resolveSection,
} from "./adr-parser.js";

/**
 * 029 Decision Records — ADR amendment and ratification engine (FR-020, FR-021, FR-022, FR-023).
 *
 * Contract: `specs/029-decision-records/contracts/adr-engine.md` §5.
 */

export interface AmendResult {
  /**
   * Full-file content. IntentEngine executes only WRITE_FILE / CREATE_DIR / RUN_COMMAND.
   * No patch or append verb exists (`intent-engine.ts:54-119`).
   */
  content: string;
  filePath: string;
  /** Registry entry added by this operation. */
  amendment: AdrAmendment;
}

const AMENDMENTS_HEADING = "Amendments";

function ensureGrowth(
  original: string,
  updated: string,
  filePath: string,
): void {
  if (updated.length <= original.length) {
    throw new Error(
      `Refusing to shrink ${filePath}; an amendment must grow it`,
    );
  }
}

/**
 * Ensures a final `## Amendments` section exists and appends a row keyed by
 * `entry.amendingId`. Idempotent when `entry.amendingId` is already registered.
 */
export function registerAmendment(
  record: AdrRecord,
  entry: AdrAmendment,
): string {
  const fresh = parseRecord(record.raw, record.filePath);
  if (fresh.amendments.some((a) => a.amendingId === entry.amendingId)) {
    return record.raw;
  }

  const row = `| ${entry.amendingId} | ${entry.at ?? ""} | ${entry.summary} |`;
  const registry = fresh.headings.find(
    (h) => h.address === null && h.title === AMENDMENTS_HEADING,
  );

  if (!registry) {
    const trimmed = record.raw.replace(/\n+$/, "");
    return [
      trimmed,
      "",
      `## ${AMENDMENTS_HEADING}`,
      "",
      "| Amending | At | Summary |",
      "|---|---|---|",
      row,
      "",
    ].join("\n");
  }

  const lines = record.raw.split("\n");
  const bodyLines = lines.slice(registry.line + 1, registry.bodyEnd);
  const hasTable = bodyLines.some((line) => line.trim().startsWith("|"));

  if (hasTable) {
    lines.splice(registry.bodyEnd, 0, row);
  } else {
    lines.splice(
      registry.bodyEnd,
      0,
      "",
      "| Amending | At | Summary |",
      "|---|---|---|",
      row,
    );
  }

  return lines.join("\n");
}

/**
 * Inserts an inline correction blockquote at `heading.bodyEnd` of the addressed
 * section and registers the amendment in `## Amendments` (FR-020, FR-026).
 */
export function amendAtSection(
  record: AdrRecord,
  address: string,
  opts: { amendingId: string; body: string },
): AmendResult {
  const cleanAddress = address.trim().replace(/^§/, "").trim();
  const target = resolveSection(record, cleanAddress);
  if (!target) {
    const existing = listSectionAddresses(record).join(", ");
    throw new Error(
      `${record.id} §${cleanAddress}: no such section. Sections: ${existing}`,
    );
  }

  const lines = record.raw.split("\n");
  lines.splice(
    target.bodyEnd,
    0,
    "",
    `> **${opts.amendingId} correction.** ${opts.body}`,
  );

  const amendment: AdrAmendment = {
    amendingId: opts.amendingId,
    at: cleanAddress,
    summary: opts.body,
  };

  const content = registerAmendment(
    { ...record, raw: lines.join("\n") },
    amendment,
  );
  ensureGrowth(record.raw, content, record.filePath);

  return {
    content,
    filePath: record.filePath,
    amendment,
  };
}

/**
 * Appends a new top-level section numbered max+1 over existing `## N.` headings,
 * placed before the `## Amendments` registry, and registers the amendment (FR-021, FR-026).
 */
export function appendSection(
  record: AdrRecord,
  opts: { amendingId: string; title: string; body: string },
): AmendResult {
  let maxNum = 0;
  for (const heading of record.headings) {
    if (
      heading.depth === 2 &&
      heading.address &&
      /^\d+$/.test(heading.address)
    ) {
      const num = Number.parseInt(heading.address, 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const nextNum = maxNum + 1;

  const registry = record.headings.find(
    (h) => h.address === null && h.title === AMENDMENTS_HEADING,
  );

  let withSection: string;
  if (registry) {
    const lines = record.raw.split("\n");
    lines.splice(
      registry.line,
      0,
      `## ${nextNum}. ${opts.title}`,
      "",
      opts.body.trimEnd(),
      "",
    );
    withSection = lines.join("\n");
  } else {
    const trimmed = record.raw.replace(/\n+$/, "");
    withSection = `${trimmed}\n\n## ${nextNum}. ${opts.title}\n\n${opts.body.trimEnd()}\n`;
  }

  const amendment: AdrAmendment = {
    amendingId: opts.amendingId,
    at: String(nextNum),
    summary: opts.title,
  };

  const content = registerAmendment({ ...record, raw: withSection }, amendment);
  ensureGrowth(record.raw, content, record.filePath);

  return {
    content,
    filePath: record.filePath,
    amendment,
  };
}

/**
 * Flips `Status: Proposed` to `Decided` and stamps `Date:` with `today` (FR-023).
 */
export function decide(record: AdrRecord, today: string): AmendResult {
  if (record.header.status === "Decided") {
    throw new Error(`${record.id} is already Decided (${record.header.date})`);
  }
  if (record.header.status === "Superseded") {
    throw new Error(`${record.id} is Superseded; --decide does not apply`);
  }

  const lines = record.raw.split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  let seenBlockquote = false;

  for (let i = h1Index + 1; i < lines.length; i++) {
    const trimmed = lines[i].replace(/\s+$/, "");
    if (trimmed.startsWith(">")) {
      seenBlockquote = true;
      lines[i] = lines[i]
        .replace(/(\*\*\s*Status\s*:\s*\*\*\s*)Proposed\b/i, "$1Decided")
        .replace(/(\*\*\s*Date\s*:\s*\*\*\s*)\S+/, `$1${today}`);
      continue;
    }
    if (seenBlockquote) break;
    if (trimmed.length === 0) continue;
    break;
  }

  return {
    content: lines.join("\n"),
    filePath: record.filePath,
    amendment: { amendingId: "", at: null, summary: "" },
  };
}
