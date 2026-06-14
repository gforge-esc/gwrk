import { describe, it, expect } from "vitest";

// Stubs to ensure compilation
export class ObsidianAdapter {
  async resolveContext() {
    throw new Error("Not implemented");
  }
}

describe("TR-019: Built-in Obsidian Vault Extension (Phase 20)", () => {
  it("FR-L3-007: returns context items matching keywords", async () => {
    const adapter = new ObsidianAdapter();
    await expect(adapter.resolveContext()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.any(String) })
      ])
    );
  });
});