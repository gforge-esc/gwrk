/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * 029 Decision Records — the ADR reader (FR-004, FR-005).
 *
 * Contract: `specs/029-decision-records/contracts/adr-engine.md` §1-2.
 *
 * The nine records on disk predate this parser, so the parser bends to them
 * rather than the other way round: two H1 styles, trailing double-space hard
 * breaks, absent relations, and `·` separating two fields on one line all parse
 * without a throw. Metadata is the house `> **Field:**` blockquote form shared
 * with `plan-renderer.ts:33-38` (TC-007) — not YAML frontmatter.
 *
 * Bare-clone operable (TC-014): no SQLite, no build server, no network.
 */

/** Status vocabulary is closed (FR-011). `Accepted`, `Rejected`, `Deprecated` are rejected. */
export type AdrStatus = "Proposed" | "Decided" | "Superseded";

/** A supersession edge as declared by the *forward* `Supersedes` field only (FR-012). */
export interface AdrSupersession {
  /** Target id when one is parseable, e.g. "ADR-001". Null for free-text forms. */
  targetId: string | null;
  /** The qualifier carried VERBATIM, e.g. "(storage mechanism only)" or
   *  "Partial aspects of ADR-002 §3 (Learning Loop Extraction)". Empty string when unqualified. */
  qualifier: string;
  /** The raw field value, for round-tripping. */
  raw: string;
}

/** The blockquote header block that follows the H1 (TC-007 — not YAML frontmatter). */
export interface AdrHeader {
  status: AdrStatus;
  /** ISO date as written, e.g. "2026-02-26". */
  date: string;
  /** Up to 240 characters, preserved verbatim; the index truncates for display (FR-004). */
  decision: string;
  /** One imperative sentence, MUST or MUST NOT. Absent on an unmigrated record (FR-010). */
  constraint: string | null;
  /** From `> **Decision Scope:**`. Projected into the index `Scope` column. */
  scope: string | null;
  author: string | null;
  /** Empty array when the field is absent — never a throw (ADR-001 carries neither). */
  dependsOn: string[];
  supersedes: AdrSupersession[];
}

/** One node of the heading tree (FR-005). */
export interface AdrHeading {
  /** Dotted section address as authored, e.g. "2", "2.1". Null for an unnumbered heading
   *  such as the `## Amendments` registry. */
  address: string | null;
  /** Markdown heading depth: 2 for `##`, 3 for `###`. */
  depth: number;
  title: string;
  /** 0-based line index of the heading itself. */
  line: number;
  /** 0-based line index one past the last line of this heading's body — the
   *  insertion point `--amend --at` uses (FR-020). */
  bodyEnd: number;
  children: AdrHeading[];
}

/** One entry of the final `## Amendments` registry (FR-022). */
export interface AdrAmendment {
  /** The amending record's id as written, e.g. "026", "028". Keyed by this (FR-022). */
  amendingId: string;
  /** Section address the amendment applies to, when the entry records one. */
  at: string | null;
  summary: string;
}

export interface AdrRecord {
  /** Zero-padded three-digit number, e.g. "010". Recovered from the FILENAME when the H1
   *  omits it, as ADR-001 and ADR-002 do (FR-004). */
  number: string;
  /** Canonical id, e.g. "ADR-010". */
  id: string;
  title: string;
  /** Absolute path on disk. `parseCorpus` supplies one; a direct `parseRecord` call
   *  carries through whatever path it was given. */
  filePath: string;
  header: AdrHeader;
  headings: AdrHeading[];
  amendments: AdrAmendment[];
  /** Full file content, unmodified. */
  raw: string;
}

/** Entries `parseCorpus` reads: the `.md` suffix AND the pattern (FR-002). */
const RECORD_FILE = /^ADR-(\d{3})-.*\.md$/;

/** `ADR-001-task-tracking.md` → `001`, for the two records whose H1 omits the number. */
const FILENAME_NUMBER = /^ADR-(\d{3})-/;

/** `# ADR: <title>` and `# ADR-007: <title>` in one shape. */
const H1_FORM = /^ADR(?:-(\d{3}))?\s*:\s*(.*)$/;

/** `> **Decision Scope:**` → `Decision Scope`. Labels never contain a colon. */
const FIELD_LABEL = /\*\*\s*([^*:]+?)\s*:\s*\*\*/g;

/** `## 2.` / `### 2.1` — the dotted address as authored. The trailing dot is optional. */
const SECTION_ADDRESS = /^(\d+(?:\.\d+)*)\.?(?:\s+(.*))?$/;

const STATUSES: readonly AdrStatus[] = ["Proposed", "Decided", "Superseded"];

/** The literal, unnumbered registry heading FR-022 and US-009 grep for. */
const AMENDMENTS_HEADING = "Amendments";

/**
 * Splits a comma-separated field value without cutting inside parentheses, so
 * `ADR-006 (Plugin Agent Backends), F014 (Plugin System)` yields two entries and
 * `Partial aspects of ADR-002 §3 (Learning Loop Extraction)` stays one.
 */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * An out-of-vocabulary status is carried through rather than coerced: FR-011
 * closes the vocabulary at `--check` time, and quietly rewriting `Accepted` to
 * `Decided` here would hide the very thing that assertion exists to report.
 */
function normalizeStatus(raw: string): AdrStatus {
  const value = raw.trim();
  const known = STATUSES.find(
    (status) => status.toLowerCase() === value.toLowerCase(),
  );
  return known ?? (value as AdrStatus);
}

/**
 * `[ADR-001](./ADR-001-task-tracking.md) (storage mechanism only)` → target
 * `ADR-001`, qualifier `(storage mechanism only)`. A value that does NOT open
 * with a reference is a free-text form (ADR-003), so the whole value is the
 * qualifier and nothing is invented on its behalf.
 */
function parseSupersession(raw: string): AdrSupersession {
  const value = raw.trim();
  const leadingRef = value.match(/^(?:\[[^\]]*\]\([^)]*\)|ADR-\d{3})\s*/);
  const qualifier = leadingRef
    ? value.slice(leadingRef[0].length).trim()
    : value;
  const target = value.match(/ADR-(\d{3})/);
  return {
    targetId: target ? `ADR-${target[1]}` : null,
    qualifier,
    raw: value,
  };
}

/**
 * Collects the blockquote block that follows the H1. Blank lines are skipped;
 * any other non-`>` line ends the search, so the inline `> **NNN correction.**`
 * blocks further down a record are never mistaken for the header.
 */
function collectHeaderLines(lines: string[], h1Index: number): string[] {
  const block: string[] = [];
  for (let i = h1Index + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (line.startsWith(">")) {
      block.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (block.length > 0) break;
    if (line.length === 0) continue;
    break;
  }
  return block;
}

/** Splits one header line into its `**Label:** value` pairs, `·`-separated or not. */
function parseHeaderLine(
  line: string,
): Array<{ label: string; value: string }> {
  const labels = [...line.matchAll(FIELD_LABEL)];
  return labels.map((match, index) => {
    const start = match.index + match[0].length;
    const end =
      index + 1 < labels.length ? labels[index + 1].index : line.length;
    const value = line
      .slice(start, end)
      .replace(/\s*·\s*$/, "")
      .trim();
    return { label: match[1], value };
  });
}

function parseHeader(
  lines: string[],
  h1Index: number,
  filename: string,
): AdrHeader {
  const block = collectHeaderLines(lines, h1Index);
  if (block.length === 0) {
    // FR-014 error state, reused verbatim by `checkIndex` and `--check`.
    throw new Error(`${filename}: no blockquote header found after the H1`);
  }

  const fields = new Map<string, string>();
  for (const line of block) {
    for (const { label, value } of parseHeaderLine(line)) {
      fields.set(label.toLowerCase(), value);
    }
  }

  const optional = (label: string): string | null => {
    const value = fields.get(label);
    return value === undefined || value.length === 0 ? null : value;
  };

  const dependsOn = fields.get("depends on");
  const supersedes = fields.get("supersedes");

  return {
    status: normalizeStatus(fields.get("status") ?? ""),
    date: fields.get("date") ?? "",
    decision: fields.get("decision") ?? "",
    constraint: optional("constraint"),
    scope: optional("decision scope"),
    author: optional("author"),
    // An absent optional field is never an error: ADR-001 carries neither.
    dependsOn: dependsOn ? splitTopLevel(dependsOn) : [],
    supersedes: supersedes
      ? splitTopLevel(supersedes).map(parseSupersession)
      : [],
  };
}

/**
 * Flat heading list in document order, skipping fenced code blocks so a `# …`
 * comment inside a ```bash fence is never read as a section.
 */
function collectHeadings(lines: string[]): AdrHeading[] {
  const flat: AdrHeading[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = line.match(/^(#{2,6})\s+(.*)$/);
    if (!heading) continue;

    const text = heading[2].trim();
    const addressed = text.match(SECTION_ADDRESS);
    flat.push({
      address: addressed ? addressed[1] : null,
      depth: heading[1].length,
      title: (addressed ? (addressed[2] ?? "") : text).trim(),
      line: i,
      bodyEnd: i + 1,
      children: [],
    });
  }

  // A section's body runs to the next heading at the same or shallower depth.
  // Trailing blank lines are not body, so `--amend --at` inserts against prose.
  for (let i = 0; i < flat.length; i++) {
    const next = flat.findIndex(
      (other, j) => j > i && other.depth <= flat[i].depth,
    );
    let end = next === -1 ? lines.length : flat[next].line;
    while (end > flat[i].line + 1 && lines[end - 1].trim().length === 0) end--;
    flat[i].bodyEnd = end;
  }

  return flat;
}

/** Nests `### 2.1` under `## 2` by depth. Duplicate addresses are both kept (FR-005). */
function nestHeadings(flat: AdrHeading[]): AdrHeading[] {
  const roots: AdrHeading[] = [];
  const stack: AdrHeading[] = [];

  for (const heading of flat) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth)
      stack.pop();
    if (stack.length === 0) roots.push(heading);
    else stack[stack.length - 1].children.push(heading);
    stack.push(heading);
  }

  return roots;
}

/** Cells of a markdown table row, minus the leading and trailing pipe. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Reads the final `## Amendments` registry (FR-022). An absent registry is an
 * empty list, not a throw — 001-009 carry none until a record is amended.
 */
function parseAmendments(lines: string[], flat: AdrHeading[]): AdrAmendment[] {
  const registry = flat.find(
    (heading) =>
      heading.address === null && heading.title === AMENDMENTS_HEADING,
  );
  if (!registry) return [];

  const amendments: AdrAmendment[] = [];
  for (const line of lines.slice(registry.line + 1, registry.bodyEnd)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = tableCells(line);
    if (cells.length === 0) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (/^amending$/i.test(cells[0])) continue;
    amendments.push({
      amendingId: cells[0],
      at: cells[1] ? cells[1] : null,
      summary: cells[2] ?? "",
    });
  }
  return amendments;
}

/**
 * Parses one record. Throws on an unparseable header only; an absent optional
 * field is never an error. See the contract §2 table for every tolerated
 * corpus inconsistency.
 */
export function parseRecord(content: string, filename: string): AdrRecord {
  const lines = content.split("\n");
  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (h1Index === -1) throw new Error(`${filename}: no H1 heading found`);

  const h1 = lines[h1Index].replace(/^#\s+/, "").trim();
  const form = h1.match(H1_FORM);
  const fromFilename = path.basename(filename).match(FILENAME_NUMBER);
  const number = form?.[1] ?? fromFilename?.[1];
  if (!number) {
    throw new Error(
      `${filename}: cannot determine the record number from the H1 or the filename`,
    );
  }

  const flat = collectHeadings(lines);

  return {
    number,
    id: `ADR-${number}`,
    title: (form?.[2] ?? h1).trim(),
    filePath: filename,
    header: parseHeader(lines, h1Index, filename),
    headings: nestHeadings(flat),
    amendments: parseAmendments(lines, flat),
    raw: content,
  };
}

/**
 * Reads every `ADR-NNN-*.md` entry of `decisionsDir`, sorted ascending by
 * number. Filters on the `.md` suffix AND the pattern, and skips directory
 * entries — a raw readdir is the research allocator's first flaw (FR-002).
 * A directory that does not exist is an empty corpus, not an error.
 */
export async function parseCorpus(decisionsDir: string): Promise<AdrRecord[]> {
  const entries = await fs
    .readdir(decisionsDir, { withFileTypes: true })
    .catch(() => null);
  if (entries === null) return [];

  const records: AdrRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!RECORD_FILE.test(entry.name)) continue;
    const filePath = path.resolve(decisionsDir, entry.name);
    records.push(parseRecord(await fs.readFile(filePath, "utf-8"), filePath));
  }

  return records.sort((a, b) => a.number.localeCompare(b.number));
}

function walkHeadings(
  nodes: AdrHeading[],
  visit: (heading: AdrHeading) => void,
): void {
  for (const node of nodes) {
    visit(node);
    walkHeadings(node.children, visit);
  }
}

/**
 * Resolves a dotted address (`"2.1"`) against the heading tree. Returns null
 * when no heading carries it — never a line-number fallback (FR-020). OQ-001:
 * `ADR-007 §78` is a line number dressed as an address, so it resolves to null.
 */
export function resolveSection(
  record: AdrRecord,
  address: string,
): AdrHeading | null {
  const wanted = address.trim().replace(/^§/, "").trim();
  if (wanted.length === 0) return null;

  let found: AdrHeading | null = null;
  walkHeadings(record.headings, (heading) => {
    if (found === null && heading.address === wanted) found = heading;
  });
  return found;
}

/**
 * Every resolvable address in document order. Consumed by the FR-020 error
 * message `ADR-007 §9.9: no such section. Sections: 1, 2, 2.1, 2.2, 2.3, 3, …`,
 * so the unnumbered `## Amendments` registry stays out.
 */
export function listSectionAddresses(record: AdrRecord): string[] {
  const addresses: string[] = [];
  walkHeadings(record.headings, (heading) => {
    if (heading.address !== null && !addresses.includes(heading.address)) {
      addresses.push(heading.address);
    }
  });
  return addresses;
}
