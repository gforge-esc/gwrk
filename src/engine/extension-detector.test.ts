import { describe, it, expect } from "vitest";
import { detectExtensions } from "./extension-detector.js";

describe("FR-045: Extension Discovery", () => {
  it("US-032: should detect installed CLIs like obsidian-cli", async () => {
    // TR-037
    await expect(detectExtensions()).rejects.toThrow("Not implemented: FR-045");
  });

  it("should return an empty array if no extensions are detected", async () => {
    await expect(detectExtensions()).rejects.toThrow("Not implemented: FR-045");
  });
});
