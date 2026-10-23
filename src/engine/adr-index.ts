/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AdrRecord } from "./adr-parser.js";

/**
 * 029 Decision Records - the ADR index generator (FR-009, FR-011, FR-012, FR-014).
 *
 * Contract: `specs/029-decision-records/contracts/adr-engine.md` §4.
 *
 * `.gwrk/decisions/index.md` is a derived projection of `docs/decisions/`,
 * generated at command time and injected into every agent dispatch via the
 * grounding channel. One row per record, never filtered by status (SC-006).
 * Supersession back-references are derived from forward `Supersedes` fields
 * alone, preserving qualifiers verbatim so partial supersession never reads
 * as retirement (FR-012).
 *
 * The content hash covers parsed headers only, not raw bytes, so prose edits
 * below the header do not report the index stale (DM-002).
 *
 * Bare-clone operable (TC-014): no SQLite, no build server, no network.
 */

export interface AdrIndexRow {
  id: string;
  scope: string;
  /** Rendered status cell, e.g. "Decided" or
   *  "Decided · superseded in part by ADR-002 (storage mechanism only)" (FR-012). */
  status: string;
  constraint: string;
}

export interface AdrIndex {
  rows: AdrIndexRow[];
  /** Hash over the PARSED HEADERS, not raw bytes (DM-002). */
  hash: string;
}

export interface AdrIndexCheck {
  ok: boolean;
  /** Ids whose parsed header disagrees with the stored index. */
  divergent: string[];
  message: string | null;
}

const INDEX_REL_PATH = path.join(".gwrk", "decisions", "index.md");
const HASH_COMMENT = /<!--\s*hash:\s*([0-9a-f]+)\s*-->/i;
const ROW_HASH_COMMENT = /<!--\s*rows:\s*(\{[^}]*\})\s*-->/;

function hashHeader(record: AdrRecord): string {
  const payload = JSON.stringify({
    id: record.id,
    number: record.number,
    title: record.title,
    status: record.header.status,
    date: record.header.date,
    decision: record.header.decision,
    constraint: record.header.constraint ?? null,
    scope: record.header.scope ?? null,
    author: record.header.author ?? null,
    dependsOn: record.header.dependsOn ?? [],
    supersedes: record.header.supersedes ?? [],
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Stable hash over parsed headers only (DM-002). Prose edits below the header
 * do not alter the hash; any mutated header field diverges.
 */
export function hashCorpus(records: AdrRecord[]): string {
  const sorted = [...records].sort((a, b) => a.number.localeCompare(b.number));
  const combined = sorted.map((r) => `${r.id}:${hashHeader(r)}`).join("|");
  return crypto
    .createHash("sha256")
    .update(combined)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Projects the parsed corpus into index rows without status filtering (FR-011)
 * and derives inverse supersession annotations with verbatim qualifiers (FR-012).
 */
export function buildIndex(records: AdrRecord[]): AdrIndex {
  const sorted = [...records].sort((a, b) => a.number.localeCompare(b.number));

  const backRefs = new Map<string, string[]>();
  for (const record of sorted) {
    for (const sup of record.header.supersedes ?? []) {
      if (!sup.targetId) continue;
      const list = backRefs.get(sup.targetId) ?? [];
      if (sup.qualifier && sup.qualifier.trim().length > 0) {
        list.push(`superseded in part by ${record.id} ${sup.qualifier.trim()}`);
      } else {
        list.push(`superseded by ${record.id}`);
      }
      backRefs.set(sup.targetId, list);
    }
  }

  const rows: AdrIndexRow[] = sorted.map((record) => {
    const inverse = backRefs.get(record.id) ?? [];
    const statusParts = [record.header.status, ...inverse];
    return {
      id: record.id,
      scope: (record.header.scope ?? "").trim(),
      status: statusParts.join(" · "),
      constraint: (record.header.constraint ?? "").trim(),
    };
  });

  return {
    rows,
    hash: hashCorpus(sorted),
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Emits a three-line preamble, the table header `| ADR | Scope | Status | Constraint |`,
 * one row per record, and the trailing hash comment (FR-009, FR-011, TC-010).
 */
export function renderIndex(index: AdrIndex): string {
  const lines: string[] = [
    "# Architecture Decision Index",
    "> Generated from `docs/decisions/`. Do not edit by hand; run `gwrk define adr --reindex`.",
    "",
    "| ADR | Scope | Status | Constraint |",
    "|---|---|---|---|",
  ];

  for (const row of index.rows) {
    lines.push(
      `| ${escapeCell(row.id)} | ${escapeCell(row.scope)} | ${escapeCell(row.status)} | ${escapeCell(row.constraint)} |`,
    );
  }

  lines.push("");
  lines.push(`<!-- hash: ${index.hash} -->`);
  return `${lines.join("\n")}\n`;
}

/**
 * Writes `.gwrk/decisions/index.md` under `projectRoot`, creating the directory
 * if absent (FR-009, TC-004).
 */
export async function writeIndex(
  projectRoot: string,
  records: AdrRecord[],
): Promise<string> {
  const index = buildIndex(records);
  const rendered = renderIndex(index);
  const rowHashes: Record<string, string> = {};
  for (const r of records) {
    rowHashes[r.id] = hashHeader(r);
  }
  const withRowMeta = rendered.replace(
    `<!-- hash: ${index.hash} -->`,
    `<!-- hash: ${index.hash} -->\n<!-- rows: ${JSON.stringify(rowHashes)} -->`,
  );

  const outPath = path.join(projectRoot, INDEX_REL_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, withRowMeta, "utf-8");
  return outPath;
}

function parseStoredRows(content: string): Map<string, AdrIndexRow> {
  const map = new Map<string, AdrIndexRow>();
  for (const line of content.split("\n")) {
    if (!line.startsWith("| ADR-")) continue;
    const cells = line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length >= 4) {
      map.set(cells[0], {
        id: cells[0],
        scope: cells[1],
        status: cells[2],
        constraint: cells[3],
      });
    }
  }
  return map;
}

/**
 * Compares the stored `.gwrk/decisions/index.md` against the parsed corpus
 * headers (FR-014).
 */
export async function checkIndex(
  projectRoot: string,
  records: AdrRecord[],
): Promise<AdrIndexCheck> {
  const indexPath = path.join(projectRoot, INDEX_REL_PATH);
  let content: string;
  try {
    content = await fs.readFile(indexPath, "utf-8");
  } catch {
    return {
      ok: false,
      divergent: records.map((r) => r.id),
      message:
        "No decision index at .gwrk/decisions/index.md. Run: gwrk define adr --reindex",
    };
  }

  const expected = buildIndex(records);
  const storedHashMatch = content.match(HASH_COMMENT);
  const storedHash = storedHashMatch ? storedHashMatch[1] : null;

  if (storedHash === expected.hash) {
    return { ok: true, divergent: [], message: null };
  }

  const divergent = new Set<string>();
  const storedRowHashesMatch = content.match(ROW_HASH_COMMENT);
  if (storedRowHashesMatch) {
    try {
      const storedRowHashes = JSON.parse(storedRowHashesMatch[1]) as Record<
        string,
        string
      >;
      const currentIds = new Set<string>();
      for (const record of records) {
        currentIds.add(record.id);
        if (storedRowHashes[record.id] !== hashHeader(record)) {
          divergent.add(record.id);
        }
      }
      for (const id of Object.keys(storedRowHashes)) {
        if (!currentIds.has(id)) {
          divergent.add(id);
        }
      }
    } catch {
      // Fallback to row comparison below.
    }
  }

  const storedRows = parseStoredRows(content);
  const expectedRowMap = new Map(expected.rows.map((r) => [r.id, r]));
  for (const [id, row] of expectedRowMap) {
    const stored = storedRows.get(id);
    if (
      !stored ||
      stored.scope !== row.scope ||
      stored.status !== row.status ||
      stored.constraint !== row.constraint
    ) {
      divergent.add(id);
    }
  }
  for (const id of storedRows.keys()) {
    if (!expectedRowMap.has(id)) {
      divergent.add(id);
    }
  }

  if (divergent.size === 0 && records.length > 0) {
    for (const r of records) divergent.add(r.id);
  }

  return {
    ok: false,
    divergent: [...divergent].sort(),
    message: "Decision index is stale. Run: gwrk define adr --reindex",
  };
}
