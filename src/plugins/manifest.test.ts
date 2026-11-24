/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { evaluateEnforcementCandidate } from "../domain/policy-selection.js";
import { AnyManifestSchema, SkillManifestSchema } from "./manifest.js";

describe("FR-013 / US-016: SkillManifestSchema Enforcement Tier", () => {
  it.each(["", "   "])(
    "keeps legacy review scope with an empty language (%s)",
    (language) => {
      const manifest = {
        type: "skill",
        tier: "enforcement",
        name: "legacy-review",
        version: "1.0.0",
        description: "Legacy review rules",
        scope: "review",
        language,
      };
      for (const schema of [SkillManifestSchema, AnyManifestSchema]) {
        const parsed = schema.parse(manifest);
        expect(parsed).toMatchObject({ tier: "enforcement", scope: "review" });
        expect("language" in parsed && parsed.language).toBe("");
      }
    },
  );

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

describe.each([
  { name: "SkillManifestSchema", schema: SkillManifestSchema },
  { name: "AnyManifestSchema", schema: AnyManifestSchema },
])("$name enforcement selectors", ({ schema }) => {
  const manifest = {
    name: "svelte-policy",
    type: "skill",
    tier: "enforcement",
    version: "1.0.0",
    description: "Svelte project policy",
  };

  it.each([
    { selectors: { framework: "Svelte" }, selector: "language" },
    { selectors: { framework: "Svelte", language: "" }, selector: "language" },
    {
      selectors: { framework: "Svelte", language: "   " },
      selector: "language",
    },
  ])("rejects invalid selectors $selectors", ({ selectors, selector }) => {
    expect(schema.safeParse({ ...manifest, ...selectors })).toMatchObject({
      success: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: [selector] }),
        ]),
      },
    });
  });

  it("accepts a valid framework and language pair", () => {
    expect(
      schema.safeParse({
        ...manifest,
        framework: "Svelte",
        language: "TypeScript",
      }),
    ).toMatchObject({
      success: true,
      data: { framework: "Svelte", language: "TypeScript" },
    });
  });

  it.each(["", "   ", "\t\n"])(
    "keeps legacy review scope with a blank framework (%s)",
    (framework) => {
      const parsed = schema.parse({
        ...manifest,
        scope: "review",
        language: "TypeScript",
        framework,
      });
      expect(parsed).toMatchObject({
        tier: "enforcement",
        scope: "review",
        language: "TypeScript",
        framework: undefined,
      });
      if (parsed.type !== "skill" || parsed.tier !== "enforcement") {
        throw new Error("Expected an enforcement skill");
      }
      expect(
        evaluateEnforcementCandidate(
          { name: parsed.name, source: "global", manifest: parsed },
          { type: "cli", stack: { language: "TypeScript" } },
          "review",
        ),
      ).toEqual({ included: true, reason: "selected" });
    },
  );

  it("defaults an unscoped legacy manifest to all workflows", () => {
    expect(schema.safeParse(manifest)).toMatchObject({
      success: true,
      data: { scope: "all" },
    });
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
