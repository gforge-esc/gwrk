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
