/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRefsContent } from "./read-refs.js";

describe("readRefsContent", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("reads a single file verbatim", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-refs-file-"));
    tempDirs.push(dir);
    const file = path.join(dir, "brief.md");
    fs.writeFileSync(file, "# Research Brief\nContent here.");

    expect(readRefsContent(file)).toBe("# Research Brief\nContent here.");
  });

  it("recursively reads markdown files from a directory and skips .obsidian", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-refs-dir-"));
    tempDirs.push(dir);

    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".obsidian", "workspace.md"), "hidden");
    fs.writeFileSync(path.join(dir, "01-Overview.md"), "# Overview");
    fs.writeFileSync(path.join(dir, "02-Architecture.md"), "# Architecture");

    const combined = readRefsContent(dir);
    expect(combined).toContain("### 01-Overview.md");
    expect(combined).toContain("# Overview");
    expect(combined).toContain("### 02-Architecture.md");
    expect(combined).toContain("# Architecture");
    expect(combined).not.toContain("hidden");
  });
});
