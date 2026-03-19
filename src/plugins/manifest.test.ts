import { describe, expect, it } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { AnyManifestSchema } from "./manifest.js";

describe("FR-002 / FR-013: Manifest Zod Schema Validation", () => {
  it("US-001: validates a valid atomic skill manifest", () => {
    const manifest = {
      type: "skill",
      name: "truth-extract",
      tier: "atomic",
      version: "1.0.0",
      description: "Extract truth from messy inputs",
      category: "reasoning",
      prompt: "Extract the truth from: {{input}}",
      interface: {
        input: "stdin",
        output: "stdout",
        exitCodes: {
          0: "Success",
          1: "Failure",
        },
      },
      runtime: {
        preferredAgent: "gemini",
        preferredModel: "gemini-2.0-flash",
        maxInputTokens: 100000,
      },
    };

    const result = AnyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("US-006: validates a valid compound skill manifest", () => {
    const manifest = {
      type: "skill",
      name: "signal-cut",
      tier: "compound",
      version: "1.0.0",
      description: "Marketing content for technical audiences",
      composes: ["narrative", "practitioner"],
      passes: [
        { name: "narrative", skill: "narrative", summary: "Frame as story" },
        { name: "practitioner", skill: "practitioner", summary: "Optimize for execution" },
      ],
      interface: {
        input: "stdin",
        output: "stdout",
        exitCodes: { 0: "Success" },
      },
      runtime: {
        preferredAgent: "claude",
        preferredModel: "claude-3-5-sonnet",
        maxInputTokens: 200000,
      },
    };

    const result = AnyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("US-001: rejects manifest with missing required fields", () => {
    const manifest = {
      type: "skill",
      name: "incomplete",
      // missing version, tier, etc.
    };

    const result = AnyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("US-001: rejects manifest with unknown plugin type", () => {
    const manifest = {
      type: "unknown-type",
      name: "bad-plugin",
      version: "1.0.0",
      description: "Should fail",
    };

    const result = AnyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("US-001: rejects invalid version format", () => {
    const manifest = {
      type: "skill",
      name: "bad-version",
      tier: "atomic",
      version: "v1", // Must be semver
      description: "Bad version",
      category: "reasoning",
      prompt: "...",
      interface: { input: "stdin", output: "stdout", exitCodes: {} },
      runtime: { preferredAgent: "gemini", preferredModel: "...", maxInputTokens: 1 },
    };

    const result = AnyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});
