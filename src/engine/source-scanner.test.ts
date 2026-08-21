/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { scan } from "./source-scanner";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("node:fs/promises");

describe("FR-L25-011: Source Material Scanner", () => {
  const root = "/root";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TR-015: should discover architecture docs and specs", async () => {
    // Mock readdir for specs/
    vi.mocked(fs.readdir).mockImplementation(async (p: string) => {
      if (p === path.join(root, "specs")) return ["001-setup"] as any;
      if (p === path.join(root, "docs", "decisions")) return ["ADR-001.md"] as any;
      throw new Error("ENOENT");
    });

    // Mock readFile
    vi.mocked(fs.readFile).mockImplementation(async (p: string) => {
      if (p === path.join(root, "specs", "001-setup", "spec.md")) return "Spec Content";
      if (p === path.join(root, "docs", "architecture.md")) return "Arch Content";
      if (p === path.join(root, "docs", "decisions", "ADR-001.md")) return "ADR Content";
      throw new Error("ENOENT");
    });

    const result = await scan(root);

    expect(result.specs).toContain("Spec Content");
    expect(result.architecture).toBe("Arch Content");
    expect(result.patterns).toContain("ADR Content");
  });

  it("FR-L25-011: should handle missing directories gracefully", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
    
    const result = await scan(root);
    expect(result.specs).toEqual([]);
    expect(result.architecture).toBe("");
  });
});

/**
 * 029 Decision Records — RED tests for TR-011 (FR-015).
 *
 * @phase 06
 * @status red
 *
 * Nine architecture decisions arriving at the ontology workflow labelled as
 * code patterns is the mislabelling this closes. `material.decisions` is an
 * ADDITIVE field: `material.patterns` survives with a narrower population, so
 * every other reader keeps compiling.
 */
describe.skip("029 FR-015: decisions get their own material field (US-007)", () => {
  const root = "/root";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readdir).mockImplementation(async (p: string) => {
      if (p === path.join(root, "specs")) return ["001-setup"] as any;
      if (p === path.join(root, "docs", "decisions"))
        return ["ADR-001-task-tracking.md", "ADR-007-single-dispatch-path.md"] as any;
      throw new Error("ENOENT");
    });
    vi.mocked(fs.readFile).mockImplementation(async (p: string) => {
      if (p === path.join(root, "specs", "001-setup", "spec.md")) return "Spec Content";
      if (p === path.join(root, "docs", "architecture.md")) return "Arch Content";
      if (p === path.join(root, "docs", "decisions", "ADR-001-task-tracking.md"))
        return "ADR-001 body";
      if (p === path.join(root, "docs", "decisions", "ADR-007-single-dispatch-path.md"))
        return "ADR-007 body";
      throw new Error("ENOENT");
    });
  });

  it("FR-015: puts decisions in material.decisions, not material.patterns", async () => {
    const result = await scan(root);

    expect(result.decisions).toContain("ADR-001 body");
    expect(result.decisions).toContain("ADR-007 body");
    // source-scanner.ts:57-69 must stop pushing ADRs into material.patterns.
    expect(result.patterns).not.toContain("ADR-001 body");
    expect(result.patterns).not.toContain("ADR-007 body");
  });

  it("FR-015: leaves material.patterns present so other readers keep compiling", async () => {
    const result = await scan(root);

    expect(Array.isArray(result.patterns)).toBe(true);
    expect(result.specs).toContain("Spec Content");
    expect(result.architecture).toBe("Arch Content");
  });

  it("FR-015: returns an empty decisions list when the directory is missing", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await scan(root);

    expect(result.decisions).toEqual([]);
  });

  it("FR-015: reads only markdown entries into decisions", async () => {
    vi.mocked(fs.readdir).mockImplementation(async (p: string) => {
      if (p === path.join(root, "docs", "decisions"))
        return ["ADR-001-task-tracking.md", "notes.txt"] as any;
      throw new Error("ENOENT");
    });
    vi.mocked(fs.readFile).mockImplementation(async (p: string) => {
      if (p === path.join(root, "docs", "decisions", "ADR-001-task-tracking.md"))
        return "ADR-001 body";
      throw new Error("ENOENT");
    });

    const result = await scan(root);

    expect(result.decisions).toEqual(["ADR-001 body"]);
  });
});
