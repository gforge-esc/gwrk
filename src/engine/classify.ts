import fs from "node:fs";
import path from "node:path";

export type ChangeClassification = "greenfield" | "change" | "refactor" | "noop";

export interface ClassifyOptions {
  files: string[];
  rootDir: string;
  modifiesBehavior?: boolean;
}

/**
 * US-003.3: Classify a task based on its touch points and behavior.
 *
 * GREENFIELD: File in touch_points does not exist.
 * CHANGE: Files exist, task modifies behavior.
 * REFACTOR: Files exist, task changes structure not behavior.
 * NOOP: No code change required (config, docs).
 */
export function classifyTask(opts: ClassifyOptions): ChangeClassification {
  const { files, rootDir, modifiesBehavior = true } = opts;

  if (!fs.existsSync(rootDir)) {
    throw new Error(`rootDir does not exist: ${rootDir}`);
  }

  if (files.length === 0) {
    return "noop";
  }

  let anyNewFile = false;
  for (const filePath of files) {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(rootDir, filePath);
    if (!fs.existsSync(fullPath)) {
      anyNewFile = true;
      break;
    }
  }

  if (anyNewFile) {
    return "greenfield";
  }

  // If all files exist, check if it's a refactor or change
  return modifiesBehavior ? "change" : "refactor";
}

/**
 * Utility to extract file paths from text.
 * Matches: src/..., tests/..., docs/..., scripts/..., gates/..., specs/...
 * And standalone files: package.json, etc.
 */
export function extractFilePaths(text: string): string[] {
  const pathRegex = /(?:src|tests|docs|scripts|gates|specs)\/(\S+)/g;
  const matches = Array.from(text.matchAll(pathRegex)).map((m) => m[0]);

  const rootFileRegex =
    /\b([\w\d\.\-]+\.(?:ts|json|md|sh|yml|sql|ts\.orig))\b/g;
  const rootMatches = Array.from(text.matchAll(rootFileRegex)).map((m) => m[0]);

  // Clean up punctuation attached to paths (like dots or commas at end of sentence)
  const clean = (s: string) => s.replace(/[\.\,\;\:]$/, "");

  return [...new Set([...matches.map(clean), ...rootMatches.map(clean)])];
}
