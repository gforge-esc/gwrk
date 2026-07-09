/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from "vitest";
import { detectExtensions } from "./extension-detector.js";

describe("FR-045: Extension Discovery", () => {
  it("US-032: should detect installed CLIs like obsidian-cli", async () => {
    // TR-037: detectExtensions probes the system for known CLI tools
    const extensions = await detectExtensions();
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);

    // Each result has the expected shape
    for (const ext of extensions) {
      expect(ext).toHaveProperty("id");
      expect(ext).toHaveProperty("name");
      expect(ext).toHaveProperty("command");
      expect(typeof ext.detected).toBe("boolean");
    }
  });

  it("should include known extension ids in the result", async () => {
    const extensions = await detectExtensions();
    const ids = extensions.map((e) => e.id);
    expect(ids).toContain("github");
    expect(ids).toContain("docker");
    expect(ids).toContain("obsidian");
    expect(ids).toContain("slack");
  });
});
