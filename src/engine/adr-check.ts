/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { checkIndex } from "./adr-index.js";
import type { AdrRecord } from "./adr-parser.js";

/**
 * 029 Decision Records — citation and index verifier (FR-024, FR-025).
 *
 * Contract: `specs/029-decision-records/contracts/adr-engine.md` §6.
 */

export interface Citation {
  file: string;
  line: number;
  adrId: string;
  correctionId: string | null;
}

export interface AdrCheckFinding {
  /** Repo-relative path of the citing file. */
  file: string;
  /** 1-indexed. */
  line: number;
  assertion: 1 | 2 | 3;
  message: string;
}

/** Directories excluded from the citation scan (AMBER-1, settles OQ-003). */
export const SCAN_IGNORE: readonly string[] = [
  "node_modules",
  "dist",
  ".git",
  ".claude",
  "cache",
  "docs/archive",
];

const SCAN_ROOTS = ["src", "docs", "specs"] as const;
const SRC_EXTENSIONS = new Set([".ts", ".yaml", ".yml", ".md"]);

function isIgnored(relPosix: string, entryName: string): boolean {
  return SCAN_IGNORE.some(
    (ignored) =>
      entryName === ignored ||
      relPosix === ignored ||
      relPosix.startsWith(`${ignored}/`),
  );
}

function extractSrcLineCitations(
  relFile: string,
  lineNum: number,
  rawLine: string,
): Citation[] {
  const cleaned = rawLine.replace(/ADR-\d{3}-<[^>]+>(?:\.md)?/g, "");
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(
    /\b(ADR-\d{3})(?:\s+§[\d.]+)?\s*\+\s*(\d{3})\s+correction\b/g,
  )) {
    const adrId = match[1];
    const correctionId = match[2];
    const key = `${adrId}:${correctionId}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ file: relFile, line: lineNum, adrId, correctionId });
    }
  }

  for (const match of cleaned.matchAll(/\b(ADR-\d{3})\b/g)) {
    const adrId = match[1];
    const hasCorrectionForAdr = citations.some((c) => c.adrId === adrId);
    if (hasCorrectionForAdr) continue;
    const key = `${adrId}:`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({
        file: relFile,
        line: lineNum,
        adrId,
        correctionId: null,
      });
    }
  }

  return citations;
}

function extractDocsOrSpecsLineCitations(
  relFile: string,
  lineNum: number,
  rawLine: string,
): Citation[] {
  const cleaned = rawLine.replace(/ADR-\d{3}-<[^>]+>(?:\.md)?/g, "");
  const citations: Citation[] = [];
  const seen = new Set<string>();

  // Markdown links whose target contains ADR-NNN
  for (const match of cleaned.matchAll(/\[[^\]]*\]\(([^)]*)\)/g)) {
    const target = match[1];
    if (target.includes("<") && target.includes(">")) continue;
    for (const idMatch of target.matchAll(/\b(ADR-\d{3})\b/g)) {
      const adrId = idMatch[1];
      if (!seen.has(adrId)) {
        seen.add(adrId);
        citations.push({
          file: relFile,
          line: lineNum,
          adrId,
          correctionId: null,
        });
      }
    }
  }

  // Literal docs/decisions/ADR-NNN... paths
  for (const match of cleaned.matchAll(
    /\bdocs\/decisions\/(ADR-\d{3})[^\s)`"']*/g,
  )) {
    const full = match[0];
    if (full.includes("<") && full.includes(">")) continue;
    const adrId = match[1];
    if (!seen.has(adrId)) {
      seen.add(adrId);
      citations.push({
        file: relFile,
        line: lineNum,
        adrId,
        correctionId: null,
      });
    }
  }

  return citations;
}

async function walkRoot(
  projectRoot: string,
  rootName: (typeof SCAN_ROOTS)[number],
  dirPath: string,
  out: Citation[],
): Promise<void> {
  const entries = await fs
    .readdir(dirPath, { withFileTypes: true })
    .catch(() => null);
  if (!entries) return;

  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sorted) {
    const fullPath = path.join(dirPath, entry.name);
    const relFile = path.relative(projectRoot, fullPath);
    const relPosix = relFile.split(path.sep).join("/");

    if (isIgnored(relPosix, entry.name)) continue;

    if (entry.isDirectory()) {
      await walkRoot(projectRoot, rootName, fullPath, out);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name);
    if (rootName === "src") {
      if (!SRC_EXTENSIONS.has(ext)) continue;
    } else if (ext !== ".md") {
      continue;
    }

    const content = await fs.readFile(fullPath, "utf-8").catch(() => null);
    if (content === null) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineCitations =
        rootName === "src"
          ? extractSrcLineCitations(relFile, i + 1, lines[i])
          : extractDocsOrSpecsLineCitations(relFile, i + 1, lines[i]);
      out.push(...lineCitations);
    }
  }
}

/**
 * Scans `src/`, `docs/`, and `specs/` under `projectRoot` using the AMBER-1
 * citation-shape rule and `SCAN_IGNORE` list (FR-024).
 */
export async function scanSurface(projectRoot: string): Promise<Citation[]> {
  const citations: Citation[] = [];
  for (const rootName of SCAN_ROOTS) {
    const rootDir = path.join(projectRoot, rootName);
    await walkRoot(projectRoot, rootName, rootDir, citations);
  }
  return citations;
}

/**
 * Evaluates the three mechanical assertions over `projectRoot` and `records`:
 * 1. Every citation from `scanSurface` resolves to a file in `docs/decisions/`.
 * 2. Every `NNN correction` citation resolves to a registered amendment in `## Amendments`.
 * 3. The stored `.gwrk/decisions/index.md` hash matches the parsed corpus headers.
 */
export async function checkCitations(
  projectRoot: string,
  records: AdrRecord[],
): Promise<AdrCheckFinding[]> {
  const byId = new Map<string, AdrRecord>(records.map((r) => [r.id, r]));
  const citations = await scanSurface(projectRoot);
  const findings: AdrCheckFinding[] = [];

  for (const citation of citations) {
    const record = byId.get(citation.adrId);
    if (!record) {
      findings.push({
        file: citation.file,
        line: citation.line,
        assertion: 1,
        message: `${citation.adrId} does not resolve to a file in docs/decisions/`,
      });
      continue;
    }

    if (citation.correctionId !== null) {
      const registered = record.amendments.some(
        (amendment) => amendment.amendingId === citation.correctionId,
      );
      if (!registered) {
        findings.push({
          file: citation.file,
          line: citation.line,
          assertion: 2,
          message: `cites a '${citation.correctionId} correction' not registered in ${citation.adrId}'s ## Amendments`,
        });
      }
    }
  }

  const indexCheck = await checkIndex(projectRoot, records);
  if (!indexCheck.ok) {
    findings.push({
      file: path.join(".gwrk", "decisions", "index.md"),
      line: 1,
      assertion: 3,
      message:
        indexCheck.message ??
        "Decision index is stale. Run: gwrk define adr --reindex",
    });
  }

  return findings;
}
