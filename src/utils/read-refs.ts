/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import path from "node:path";

const IGNORED_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

function collectMarkdownFilesSync(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFilesSync(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      acc.push(fullPath);
    }
  }

  return acc.sort((a, b) => a.localeCompare(b));
}

/**
 * Reads reference material from either a single file or a directory of markdown files
 * (such as an Obsidian vault or `docs/grounding/`).
 */
export function readRefsContent(resolvedRefsPath: string): string {
  try {
    return fs.readFileSync(resolvedRefsPath, "utf-8");
  } catch (err: any) {
    if (err?.code !== "EISDIR") {
      throw err;
    }
  }

  const mdFiles = collectMarkdownFilesSync(resolvedRefsPath);
  return mdFiles
    .map((filePath) => {
      const rel = path.relative(resolvedRefsPath, filePath).replace(/\\/g, "/");
      const content = fs.readFileSync(filePath, "utf-8");
      return `### ${rel}\n\n${content}`;
    })
    .join("\n\n---\n\n");
}
