/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";

export interface SourceMaterial {
  specs: string[];
  architecture: string;
  patterns: string[];
  decisions: string[];
}

export interface ScanOptions {
  maxArchChars?: number;
  maxSpecsChars?: number;
  maxPerSpecChars?: number;
  maxDecisionsChars?: number;
  maxPerDecisionChars?: number;
}

export const DEFAULT_MAX_ARCH_CHARS = 16_000;
export const DEFAULT_MAX_SPECS_CHARS = 24_000;
export const DEFAULT_MAX_PER_SPEC_CHARS = 2_400;
export const DEFAULT_MAX_DECISIONS_CHARS = 12_000;
export const DEFAULT_MAX_PER_DECISION_CHARS = 1_600;

function truncateDocument(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const sliced = content.slice(0, maxChars);
  const lastNewline = sliced.lastIndexOf("\n");
  const cleanSlice = lastNewline > maxChars * 0.5 ? sliced.slice(0, lastNewline) : sliced;
  return `${cleanSlice}\n...[truncated]`;
}

/**
 * FR-L25-011: Scan specs and codebase for grounding material with bounded token budgets.
 */
export async function scan(
  projectRoot: string,
  options: ScanOptions = {},
): Promise<SourceMaterial> {
  const maxArchChars = options.maxArchChars ?? DEFAULT_MAX_ARCH_CHARS;
  const maxSpecsChars = options.maxSpecsChars ?? DEFAULT_MAX_SPECS_CHARS;
  const maxPerSpecChars = options.maxPerSpecChars ?? DEFAULT_MAX_PER_SPEC_CHARS;
  const maxDecisionsChars = options.maxDecisionsChars ?? DEFAULT_MAX_DECISIONS_CHARS;
  const maxPerDecisionChars =
    options.maxPerDecisionChars ?? DEFAULT_MAX_PER_DECISION_CHARS;

  const material: SourceMaterial = {
    specs: [],
    architecture: "",
    patterns: [],
    decisions: [],
  };

  // 1. Scan specs/ directory (newest features ranked first, bounded by maxSpecsChars)
  const specsDir = path.join(projectRoot, "specs");
  try {
    const featureDirs = [...(await fs.readdir(specsDir))].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    let totalSpecChars = 0;
    for (const feature of featureDirs) {
      if (totalSpecChars >= maxSpecsChars) break;
      const specPath = path.join(specsDir, feature, "spec.md");
      try {
        const raw = await fs.readFile(specPath, "utf-8");
        const remaining = maxSpecsChars - totalSpecChars;
        const cap = Math.min(maxPerSpecChars, remaining);
        if (cap <= 0) break;
        const entry = truncateDocument(raw, cap);
        material.specs.push(entry);
        totalSpecChars += entry.length;
      } catch {
        // Skip missing spec.md
      }
    }
  } catch {
    // No specs dir
  }

  // 2. Scan for architecture grounding across all known architecture docs
  const archPaths = [
    path.join(projectRoot, "docs", "grounding", "architecture.md"),
    path.join(projectRoot, "docs", "architecture.md"),
    path.join(projectRoot, "ARCHITECTURE.md"),
    path.join(projectRoot, "README.md"),
  ];

  const archChunks: string[] = [];
  let totalArchChars = 0;
  for (const archPath of archPaths) {
    if (totalArchChars >= maxArchChars) break;
    try {
      const content = await fs.readFile(archPath, "utf-8");
      if (!content || archChunks.includes(content)) continue;
      const remaining = maxArchChars - totalArchChars;
      const chunk = truncateDocument(content, remaining);
      archChunks.push(chunk);
      totalArchChars += chunk.length;
    } catch {
      // Try next path
    }
  }
  material.architecture = archChunks.join("\n\n---\n\n");

  // 3. Scan for architecture decisions (FR-015, bounded by maxDecisionsChars)
  const decisionsDir = path.join(projectRoot, "docs", "decisions");
  try {
    const adrs = [...(await fs.readdir(decisionsDir))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    let totalDecisionChars = 0;
    for (const adr of adrs) {
      if (!adr.endsWith(".md")) continue;
      if (totalDecisionChars >= maxDecisionsChars) break;
      try {
        const raw = await fs.readFile(path.join(decisionsDir, adr), "utf-8");
        const remaining = maxDecisionsChars - totalDecisionChars;
        const cap = Math.min(maxPerDecisionChars, remaining);
        if (cap <= 0) break;
        const entry = truncateDocument(raw, cap);
        material.decisions.push(entry);
        totalDecisionChars += entry.length;
      } catch {
        // Skip unreadable decision
      }
    }
  } catch {
    // No decisions dir
  }

  return material;
}
