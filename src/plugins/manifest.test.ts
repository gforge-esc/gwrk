/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { AnyManifestSchema, SkillManifestSchema } from "./manifest.js";

describe("FR-013 / US-016: SkillManifestSchema Enforcement Tier", () => {
  it("TR-P9-003: accepts tier: enforcement and scope: implementation", () => {
    const manifest = {
      name: "typescript-standards",
      type: "skill",
      tier: "enforcement",
      scope: "implementation",
      version: "1.0.0",
      description: "Strict TypeScript enforcement",
    };

    const result = SkillManifestSchema.parse(manifest);
    expect(result.tier).toBe("enforcement");
    expect(result.scope).toBe("implementation");
  });

  it("keeps architecture and principle selectors on definition skills", () => {
    const manifest = {
      name: "hexagonal-policy",
      type: "skill",
      tier: "enforcement",
      version: "1.0.0",
      description: "Hexagonal project policy",
      scope: "define",
      language: "TypeScript",
      architectures: ["hexagonal-functional"],
      principles: ["functional-core", "tdd"],
      projectScope: "gwrk",
    };

    expect(SkillManifestSchema.parse(manifest)).toMatchObject(manifest);
    expect(
      SkillManifestSchema.safeParse({ ...manifest, principles: ["unknown"] })
        .success,
    ).toBe(false);
    const legacy = SkillManifestSchema.parse({
      name: "legacy-policy",
      type: "skill",
      tier: "enforcement",
      version: "1.0.0",
      description: "Legacy policy",
    });
    expect(legacy.scope).toBe("all");
  });

  it("TR-007: validates optional architectures and principles and projectScope selectors", () => {
    const validWithAny = {
      name: "universal-policy",
      type: "skill",
      tier: "enforcement",
      version: "1.0.0",
      description: "Universal enforcement policy",
      projectScope: "any",
      architectures: ["clean", "layered"],
      principles: ["clean-code" as const],
    };
    expect(SkillManifestSchema.parse(validWithAny)).toMatchObject(validWithAny);

    const invalidProjectScope = {
      ...validWithAny,
      projectScope: "invalid-scope",
    };
    expect(SkillManifestSchema.safeParse(invalidProjectScope).success).toBe(
      false,
    );
  });

  it("rejects invalid scope for enforcement skills", () => {
    const manifest = {
      name: "bad-skill",
      type: "skill",
      tier: "enforcement",
      scope: "invalid-scope",
      version: "1.0.0",
    };

    expect(() => SkillManifestSchema.parse(manifest)).toThrow();
  });
});

describe("ExtensionManifestSchema (Phase 19)", () => {
  it("FR-L3-001: validates a valid extension manifest", () => {
    const manifest = {
      name: "obsidian-vault",
      type: "extension",
      version: "1.0.0",
      description: "Obsidian integration",
      provides: ["context"],
      adapter: "./adapter.js",
    };

    const result = AnyManifestSchema.parse(manifest);
    expect(result.type).toBe("extension");
    expect((result as any).provides).toContain("context");
  });

  it("rejects invalid provides values", () => {
    const manifest = {
      name: "bad-ext",
      type: "extension",
      version: "1.0.0",
      description: "Bad extension",
      provides: ["invalid-capability"],
      adapter: "./adapter.js",
    };

    expect(() => AnyManifestSchema.parse(manifest)).toThrow();
  });
});
