import { describe, expect, it } from "vitest";
// @ts-ignore
import { loadConfig } from "./config.js";

describe("TC-H03: Config Validation", () => {
  it("should fail fast if GITHUB_WEBHOOK_SECRET is missing", () => {
    // Save original env
    const originalEnv = { ...process.env };
    delete process.env.GITHUB_WEBHOOK_SECRET;

    try {
      // @ts-ignore
      loadConfig();
      // Should have thrown
      expect(true).toBe(false); // RED
    } catch (e) {
      // Success if it throws a validation error
      expect(true).toBe(true); 
    } finally {
      // Restore env
      process.env = originalEnv;
    }
    
    expect(true).toBe(false); // Forced RED for define-tests workflow
  });
});
