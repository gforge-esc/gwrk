import { describe, it, expect } from "vitest";
import { ObsidianAdapter } from "./adapter.js";

describe("TR-019: Built-in Obsidian Vault Extension (Phase 20)", () => {
  it("FR-L3-007: returns context items matching keywords", async () => {
    const adapter = new ObsidianAdapter();
    const results = await adapter.resolveContext({
      keywords: ["test"],
      projectRoot: "/fake",
      config: { vaultPath: "/fake/vault" }
    });
    
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.any(String) })
      ])
    );
  });
});
