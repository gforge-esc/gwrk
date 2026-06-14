import { describe, it, expect } from "vitest";
import { detectExtensions } from "./extension-detector.js";

describe("FR-045: Extension Discovery", () => {
  it("US-032: detects obsidian-cli if installed", async () => {
    // Should mock 'which obsidian-cli' returning a path
    const extensions = await detectExtensions();
    expect(extensions).toBeDefined();
    expect(extensions).toHaveProperty("obsidian-cli");
  });

  it("returns empty object if no known extensions found", async () => {
    const extensions = await detectExtensions();
    expect(Object.keys(extensions).length).toBe(0);
  });
});
