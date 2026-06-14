import { describe, expect, it } from "vitest";
import { GwrkConfigSchema, resolveEffortConfig } from "./config.js";

describe("FR-017: Three-layer Config Resolution", () => {
  it("should resolve using internal defaults when no config is provided", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "test-project" },
      agents: {},
    });
    const effort = resolveEffortConfig(config);
    expect(effort.profile).toBe("TS");
    expect(effort.locRate).toBe(50);
    expect(effort.hoursPerSP).toBe(4);
  });

  it("should resolve using profile-specific defaults (Rust)", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "test-project" },
      agents: {},
      effort: { profile: "Rust" },
    });
    const effort = resolveEffortConfig(config);
    expect(effort.profile).toBe("Rust");
    expect(effort.locRate).toBe(35);
    expect(effort.hoursPerSP).toBe(6); // RE multiplier
  });

  it("should allow explicit overrides to trump defaults", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "test-project" },
      agents: {},
      effort: {
        profile: "TS",
        locRates: { TS: 30 },
        roles: { TS: { hoursPerSP: 2 } },
      },
    });
    const effort = resolveEffortConfig(config);
    expect(effort.locRate).toBe(30);
    expect(effort.hoursPerSP).toBe(2);
  });

  it("TC-003: should validate effort section in GwrkConfigSchema", () => {
    const validEffort = {
      project: { name: "test-project" },
      agents: {},
      effort: {
        profile: "default",
        locRates: { TS: 50 },
      },
    };
    // DM-001: Effort profile schema verification
    expect(() => GwrkConfigSchema.parse(validEffort)).not.toThrow();
  });

  it("should throw error for invalid effort rate types", () => {
    const invalidEffort = {
      project: { name: "test-project" },
      agents: {},
      effort: {
        locRates: { TS: "fast" }, // Should be number
      },
    };
    expect(() => GwrkConfigSchema.parse(invalidEffort)).toThrow();
  });
});

describe("FR-001: Workspace Configuration Schema (020-polyglot-monorepo)", () => {
  it("US-001: should validate GwrkConfigSchema with valid workspaces", () => {
    const validConfig = {
      project: {
        name: "polyglot-project",
        type: "pnpm-monorepo",
        stack: { language: "TypeScript", packageManager: "pnpm" },
        layout: "monorepo"
      },
      agents: {},
      workspaces: {
        web: {
          stack: { language: "typescript" }
        },
        backend: {
          stack: { language: "rust" }
        }
      }
    };
    expect(() => GwrkConfigSchema.parse(validConfig)).not.toThrow();
  });

  it("FR-032: should validate GwrkConfigSchema with extended profile fields", () => {
    const validConfig = {
      project: {
        name: "extended-project",
        type: "gwrk-native",
        stack: {
          language: "TypeScript",
          framework: "React",
          buildSystem: "pnpm",
          testFramework: "vitest"
        },
        layout: "monorepo",
        architecture: "docs/architecture.md",
        conventions: "docs/conventions.md"
      },
      agents: {}
    };
    const parsed = GwrkConfigSchema.parse(validConfig);
    expect(parsed.project.type).toBe("gwrk-native");
    expect(parsed.project.stack?.testFramework).toBe("vitest");
    expect(parsed.project.architecture).toBe("docs/architecture.md");
  });

  it("US-001: should throw error for invalid workspace configuration", () => {
    const invalidConfig = {
      project: { name: "polyglot-project" },
      agents: {},
      workspaces: {
        web: {
          stack: "typescript" // Invalid, should be an object
        }
      }
    };
    expect(() => GwrkConfigSchema.parse(invalidConfig)).toThrow();
  });
});
