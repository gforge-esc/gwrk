/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { scaffold } from "./ontology-scaffold";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("node:fs/promises");

describe("FR-L25-009: Ontology Scaffolding", () => {
  const root = "/test-project";

  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate files not existing by default
    vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
  });

  it("US-020: should create the required directory structure", async () => {
    await scaffold(root);

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(root, ".gwrk/ontology"), { recursive: true });
    expect(fs.mkdir).toHaveBeenCalledWith(path.join(root, ".gwrk/perspective"), { recursive: true });
  });

  it("US-020: should scaffold empty placeholder files", async () => {
    await scaffold(root);

    const files = [
      ".gwrk/ontology/domain.md",
      ".gwrk/perspective/hierarchy.md",
      ".gwrk/perspective/ux-posture.md",
    ];

    for (const file of files) {
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(root, file),
        expect.stringContaining("# ")
      );
    }
  });
});
