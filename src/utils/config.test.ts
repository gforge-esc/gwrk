import { describe, it, expect } from "vitest";
import { GwrkConfigSchema } from "./config.js";

describe("FR-032 / TC-011: Configuration Schema Extensions", () => {
  it("TR-033: parses legacy .gwrkrc.json without project profile fields", () => {
    const legacyConfig = {
      featureDir: "specs",
      historyPath: ".gwrk/history.jsonl"
    };
    const result = GwrkConfigSchema.safeParse(legacyConfig);
    expect(result.success).toBe(true);
  });

  it("TR-033: parses new .gwrkrc.json with project profile details", () => {
    const newConfig = {
      project: {
        type: "pnpm-monorepo",
        stack: {
          language: "typescript",
          packageManager: "pnpm",
          testFramework: "vitest"
        },
        layout: {
          src: "src",
          tests: "src/**/*.test.ts"
        }
      }
    };
    const result = GwrkConfigSchema.safeParse(newConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project?.type).toBe("pnpm-monorepo");
    }
  });

  it("FR-032: fails validation for invalid project.stack fields", () => {
    const invalidConfig = {
      project: {
        stack: {
          language: 123 // Must be string
        }
      }
    };
    const result = GwrkConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});