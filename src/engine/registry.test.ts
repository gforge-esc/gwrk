import { describe, it, expect } from "vitest";
import { syncRegistry } from "./registry.js";

describe("FR-044: Registry Sync", () => {
  it("US-001: should clone gwrk-plugins if not present", async () => {
    // TR-036
    await expect(syncRegistry()).rejects.toThrow("Not implemented: FR-044");
  });

  it("US-001: should pull gwrk-plugins if already present", async () => {
    await expect(syncRegistry()).rejects.toThrow("Not implemented: FR-044");
  });
});
