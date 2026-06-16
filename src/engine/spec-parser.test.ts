/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractStories } from "./spec-parser.js";

describe("spec-parser: extractStories (FR-001)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-parser-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeSpec(content: string): string {
    const featureDir = path.join(tempDir, "specs", "001-test");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), content);
    return featureDir;
  }

  it("TR-001: US-001 - extracts stories with SP and roles correctly", () => {
    const featureDir = writeSpec(`
# Feature Spec

### US-001 - Single Feature Estimate [5 SP, TS, PE]
As a user...

### US-002: Another Story (Priority: P0, 3 SP, RE)
As an admin...
`);

    const stories = extractStories(featureDir);
    expect(stories).toHaveLength(2);

    expect(stories[0].storyId).toBe("US-001");
    expect(stories[0].title).toBe("Single Feature Estimate");
    expect(stories[0].sp).toBe(5);
    expect(stories[0].roles).toContain("TS");
    expect(stories[0].roles).toContain("PE");

    expect(stories[1].storyId).toBe("US-002");
    expect(stories[1].title).toBe("Another Story");
    expect(stories[1].sp).toBe(3);
    expect(stories[1].roles).toContain("RE");
    expect(stories[1].priority).toBe("P0");
  });

  it("should handle stories without SP or roles", () => {
    const featureDir = writeSpec(`
### US-003 - Empty Story
No tags here.
`);

    const stories = extractStories(featureDir);
    expect(stories[0].storyId).toBe("US-003");
    expect(stories[0].sp).toBe(0);
    expect(stories[0].roles).toHaveLength(0);
    expect(stories[0].unestimated).toBe(true);
  });

  it("should throw if spec.md is missing", () => {
    const emptyDir = path.join(tempDir, "empty");
    fs.mkdirSync(emptyDir);
    expect(() => extractStories(emptyDir)).toThrow(/spec.md not found/);
  });

  it("should throw if no stories found", () => {
    const featureDir = writeSpec("# Just a title\nNo stories here.");
    expect(() => extractStories(featureDir)).toThrow(/No user stories found/);
  });
});
