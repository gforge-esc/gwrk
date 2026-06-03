import { describe, it, expect, vi } from "vitest";
import { scan } from "./source-scanner";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

describe("FR-L25-011: Source Material Scanner", () => {
  it("US-022: should discover architecture docs and specs", async () => {
    const mockFiles = [
      "docs/grounding/architecture.md",
      "specs/001-setup/spec.md",
      "src/index.ts",
      "README.md"
    ];

    // Simplified recursive mock
    vi.mocked(fs.readdir).mockResolvedValue(mockFiles as any);

    const result = await scan("/root");

    expect(result).toContain("docs/grounding/architecture.md");
    expect(result).toContain("specs/001-setup/spec.md");
  });

  it("FR-L25-011: should handle missing directories gracefully", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));
    
    await expect(scan("/non-existent")).rejects.toThrow();
  });
});
