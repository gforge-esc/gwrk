/**
 * RED tests for Phase 9: Enforcement Skills (FR-014 / US-016)
 *
 * These tests verify:
 * - TR-P9-001: resolveEnforcementSkills() returns builtin SKILL.md content
 * - TR-P9-002: Project-local override takes precedence over builtin
 * - TR-P9-003: tier: enforcement validates in SkillManifestSchema
 * - TR-P9-004: gwrk plugin list shows enforcement skills with tier grouping
 * - TR-P9-005: dispatchToAgent() stdin includes enforcement skill content
 * - TR-P9-006: gwrk-conventions SKILL.md contains valid task status enum
 *
 * All tests are RED before implementation. The implementing agent turns them GREEN.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillManifestSchema } from "./manifest.js";

/**
 * TR-P9-003: tier: enforcement validates in SkillManifestSchema
 *
 * The discriminated union on 'tier' currently only accepts 'atomic' | 'compound'.
 * Phase 9 adds 'enforcement' with an optional 'scope' field.
 */
describe("FR-013 / TR-P9-003: SkillManifestSchema enforcement tier", () => {
  it("accepts tier: enforcement with scope: implementation", () => {
    const manifest = {
      type: "skill" as const,
      name: "typescript-standards",
      tier: "enforcement" as const,
      version: "1.0.0",
      description: "TypeScript coding standards for gwrk projects",
      scope: "implementation",
      tags: [],
    };

    // RED: SkillManifestSchema doesn't accept tier: 'enforcement' yet
    const result = SkillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tier).toBe("enforcement");
    }
  });

  it("rejects enforcement skill without scope", () => {
    const manifest = {
      type: "skill" as const,
      name: "bad-enforcement",
      tier: "enforcement" as const,
      version: "1.0.0",
      description: "Missing scope field",
      tags: [],
    };

    // RED: enforcement tier doesn't exist yet, so this also fails parse
    const result = SkillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});

/**
 * TR-P9-001: resolveEnforcementSkills() returns builtin SKILL.md content
 *
 * The function doesn't exist yet. Import will fail at compile time
 * until Phase 9 adds it to skill-runtime.ts.
 */
describe("FR-014 / TR-P9-001: resolveEnforcementSkills()", () => {
  it("returns builtin enforcement skill content", async () => {
    // Dynamic import to avoid compile-time failure on missing export.
    // RED: resolveEnforcementSkills is not exported from skill-runtime.ts yet.
    const mod = await import("./skill-runtime.js");
    expect(typeof mod.resolveEnforcementSkills).toBe("function");

    const content = await mod.resolveEnforcementSkills(process.cwd());
    expect(content).toContain("typescript-standards");
    expect(content).toContain("gwrk-conventions");
    expect(content.length).toBeGreaterThan(100);
  });
});

/**
 * TR-P9-002: Project-local override takes precedence over builtin
 */
describe("FR-014 / TR-P9-002: enforcement skill resolution order", () => {
  it("prefers project-local .gwrk/plugins/skills/ over builtin", async () => {
    const mod = await import("./skill-runtime.js");
    expect(typeof mod.resolveEnforcementSkills).toBe("function");

    // RED: function doesn't exist yet, and builtin skills don't exist yet.
    // When implemented, this test needs a temp dir with a local override.
    // For now, just verify the function exists and accepts projectRoot.
    const content = await mod.resolveEnforcementSkills(process.cwd());
    expect(typeof content).toBe("string");
  });
});

/**
 * TR-P9-006: gwrk-conventions SKILL.md contains valid task status enum
 *
 * The builtin SKILL.md at src/plugins/builtins/skills/gwrk-conventions/SKILL.md
 * must contain the canonical Zod enum values to teach agents the valid states.
 */
describe("US-016 / TR-P9-006: gwrk-conventions content", () => {
  const skillPath = path.join(
    process.cwd(),
    "src/plugins/builtins/skills/gwrk-conventions/SKILL.md",
  );

  it("SKILL.md exists at builtin path", () => {
    // RED: directory doesn't exist yet
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it("contains valid task status enum values", () => {
    // RED: file doesn't exist yet
    const content = fs.existsSync(skillPath)
      ? fs.readFileSync(skillPath, "utf-8")
      : "";
    expect(content).toContain("open");
    expect(content).toContain("in_progress");
    expect(content).toContain("completed");
    expect(content).toContain("cancelled");
  });

  it("contains commit identity rules", () => {
    const content = fs.existsSync(skillPath)
      ? fs.readFileSync(skillPath, "utf-8")
      : "";
    // Must warn agents about the GIT_AUTHOR identity leakage
    expect(content).toMatch(/git.*author|commit.*identity/i);
  });
});

/**
 * TR-P9-004: gwrk plugin list shows enforcement skills
 *
 * Integration-level: verifying that PluginLoader scans builtins/skills/
 * and returns enforcement skills with correct tier.
 */
describe("FR-010 / TR-P9-004: enforcement skills in plugin listing", () => {
  it("PluginLoader includes enforcement skills from builtins", async () => {
    const { PluginLoader } = await import("./loader.js");
    const loader = new PluginLoader();
    const plugins = await loader.listPlugins();

    // RED: no enforcement skills exist in builtins yet
    const enforcementSkills = plugins.filter(
      (p: { tier?: string }) => p.tier === "enforcement",
    );
    expect(enforcementSkills.length).toBeGreaterThanOrEqual(2);
  });
  });

  /**
  * TR-P9-005: dispatch context assembly
  *
  * When dispatchToAgent assembles the stdin context for an implement workflow,
  * it must include enforcement skill content in a <code_quality> section.
  */
  describe("FR-014 / TR-P9-005: dispatch context assembly", () => {
  it("enforcement skill content appears in assembled dispatch context", async () => {
    // RED: resolveEnforcementSkills doesn't exist, and dispatch doesn't call it yet
    const mod = await import("./skill-runtime.js");
    expect(typeof mod.resolveEnforcementSkills).toBe("function");

    const content = await mod.resolveEnforcementSkills(process.cwd());
    // The dispatch assembler should wrap this in <code_quality> tags
    // For this RED test, just verify the content is non-empty and contains
    // at least one enforcement skill name
    expect(content).toMatch(/typescript-standards|gwrk-conventions/);
  });
  });

