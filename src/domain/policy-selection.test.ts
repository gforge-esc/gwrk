/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "./types.js";

const profile = {
  type: "webapp",
  stack: { language: "TypeScript", framework: "Fastify" },
  design: {
    architecture: "hexagonal-functional",
    principles: ["functional-core", "clean-code", "tdd"],
    templateVersion: "1.0.0",
  },
} satisfies ProjectProfile;

const fastify = {
  name: "fastify-policy",
  version: "1.0.0",
  description: "Fastify project policy",
  language: "TypeScript",
  framework: "Fastify",
  architectures: ["hexagonal-functional"],
  principles: ["tdd" as const],
};

describe("Project policy composition", () => {
  it("preserves punctuation in bundled framework lookups", async () => {
    const { contextMarkdown, lookupFrameworkGuidance } = await import(
      "./architecture-context.js"
    );
    expect(lookupFrameworkGuidance("React+")).toBeUndefined();
    expect(
      contextMarkdown(
        {
          projectName: "example",
          design: profile.design,
          language: "TypeScript",
          framework: "React+",
          decisionsDir: "docs/decisions",
        },
        [],
      ),
    ).toContain("No bundled framework binding.");
  });

  it("keeps framework selectors with different punctuation distinct", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile: {
        ...profile,
        stack: { language: "TypeScript", framework: "Framework#" },
      },
      candidates: [
        {
          name: "framework-policy",
          source: "global",
          manifest: {
            ...fastify,
            name: "framework-policy",
            framework: "Framework+",
          },
        },
      ],
    });
    expect(result.selectedSkills).toEqual([]);
    expect(result.excludedSkills).toEqual([
      {
        name: "framework-policy",
        source: "global",
        reason: "framework-mismatch",
      },
    ]);
    expect(result.gaps).toMatchObject([
      { kind: "missing-framework-binding", subject: "Framework#" },
    ]);
  });

  it("matches the Next.js alias in policies and bundled guidance", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const candidate = {
      name: "nextjs-policy",
      source: "global" as const,
      manifest: { ...fastify, name: "nextjs-policy", framework: "nextjs" },
    };
    const result = composeEffectivePolicy({
      profile: {
        ...profile,
        stack: { language: "TypeScript", framework: " Next.js " },
      },
      candidates: [candidate],
    });
    expect(result.selectedSkills).toEqual([candidate]);
    expect(result.frameworkGuidance).toContain("Next.js routes");
    expect(result.gaps).toEqual([]);
  });

  it("excludes a disabled review policy in evaluation and composition", async () => {
    const { composeEffectivePolicy, evaluateEnforcementCandidate } =
      await import("./policy-selection.js");
    const reviewProfile = {
      ...profile,
      stack: { language: "TypeScript", framework: "Svelte" },
    };
    const manifest = {
      ...fastify,
      name: "svelte-review",
      scope: "review" as const,
      framework: "Svelte",
    };
    const override = {
      name: manifest.name,
      source: "project-local" as const,
      manifest: { ...manifest, disabled: true },
    };

    expect(
      evaluateEnforcementCandidate(override, reviewProfile, "review"),
    ).toEqual({ included: false, reason: "disabled" });
    const result = composeEffectivePolicy({
      profile: reviewProfile,
      scope: "review",
      candidates: [
        override,
        { name: manifest.name, source: "global", manifest },
      ],
    });
    expect(result.selectedSkills).toEqual([]);
    expect(result.excludedSkills).toEqual([
      { name: manifest.name, source: "project-local", reason: "disabled" },
      { name: manifest.name, source: "global", reason: "shadowed-by-override" },
    ]);
  });

  it.each([
    undefined,
    "",
    "   ",
    "none",
    "NONE",
    " None ",
    "unspecified",
    " Unspecified ",
  ])("treats framework placeholder %s as absent", async (framework) => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile: { ...profile, stack: { language: "TypeScript", framework } },
      candidates: [
        {
          name: "placeholder-policy",
          source: "global",
          manifest: {
            ...fastify,
            name: "placeholder-policy",
            framework: "None",
          },
        },
      ],
    });
    expect(result.selectedSkills).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it("keeps framework composition stable after a caller mutates a returned binding", async () => {
    const { lookupFrameworkBinding } = await import(
      "./architecture-context.js"
    );
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const input = {
      profile: {
        ...profile,
        stack: { language: "TypeScript", framework: "Django" },
      },
      candidates: [],
    };
    const before = composeEffectivePolicy(input);
    const binding = lookupFrameworkBinding("Django") as {
      guidance: string;
      languages: string[];
    };
    const original = {
      guidance: binding.guidance,
      languages: [...binding.languages],
    };
    try {
      try {
        binding.languages.push("typescript");
        binding.guidance = "Changed guidance";
      } catch {}
      expect(composeEffectivePolicy(input)).toEqual(before);
      expect(lookupFrameworkBinding("Django")).toEqual(original);
    } finally {
      try {
        binding.languages.splice(
          0,
          binding.languages.length,
          ...original.languages,
        );
        binding.guidance = original.guidance;
      } catch {}
    }
  });

  it.each([
    {
      blankSelector: "framework",
      selectors: { language: "TypeScript", framework: "   " },
      reason: "selected",
    },
    {
      blankSelector: "language",
      selectors: { language: "   " },
      reason: "legacy-global-unscoped",
    },
  ])(
    "applies a legacy review policy with a blank $blankSelector selector",
    async ({ selectors, reason }) => {
      const { SkillManifestSchema } = await import("../plugins/manifest.js");
      const { composeEffectivePolicy, evaluateEnforcementCandidate } =
        await import("./policy-selection.js");
      const manifest = {
        name: "legacy-review",
        description: "Legacy review rules",
        version: "1.0.0",
        type: "skill",
        tier: "enforcement",
        scope: "review" as const,
        ...selectors,
      };

      for (const candidateManifest of [
        manifest,
        SkillManifestSchema.parse(manifest),
      ]) {
        const candidate = {
          name: manifest.name,
          source: "global" as const,
          manifest: candidateManifest,
        };
        expect
          .soft(evaluateEnforcementCandidate(candidate, profile, "review"))
          .toEqual({ included: true, reason });

        const input = { profile, candidates: [candidate] };
        expect
          .soft(composeEffectivePolicy({ ...input, scope: "review" }))
          .toMatchObject({ selectedSkills: [candidate], excludedSkills: [] });
        expect(
          composeEffectivePolicy({ ...input, scope: "implementation" }),
        ).toMatchObject({
          selectedSkills: [],
          excludedSkills: [
            { name: manifest.name, source: "global", reason: "scope-mismatch" },
          ],
        });
      }
    },
  );

  it.each([undefined, "", "   "])(
    "rejects a framework policy without a nonblank language selector (%s)",
    async (language) => {
      const { composeEffectivePolicy, evaluateEnforcementCandidate } =
        await import("./policy-selection.js");
      const target = {
        ...profile,
        stack: { language: "TypeScript", framework: "Svelte" },
      };
      const invalid = {
        name: "svelte-policy",
        source: "global" as const,
        manifest: {
          ...fastify,
          name: "svelte-policy",
          framework: "Svelte",
          language,
        },
      };
      expect(
        evaluateEnforcementCandidate(invalid, target, "implementation"),
      ).toEqual({ included: false, reason: "language-mismatch" });
      const result = composeEffectivePolicy({
        profile: target,
        scope: "implementation",
        candidates: [invalid],
      });
      expect(result.selectedSkills).toEqual([]);
      expect(result.gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "incompatible-framework-policy" }),
        ]),
      );
      const valid = {
        ...invalid,
        manifest: { ...invalid.manifest, language: "TypeScript" },
      };
      const control = composeEffectivePolicy({
        profile: target,
        scope: "implementation",
        candidates: [valid],
      });
      expect(control.selectedSkills).toHaveLength(1);
      expect(control.gaps).toEqual([]);
    },
  );

  it("selects the highest-precedence compatible copy of a framework policy", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile,
      scope: "define",
      candidates: [
        { name: fastify.name, source: "builtin", manifest: fastify },
        { name: fastify.name, source: "project-entry", manifest: fastify },
        {
          name: fastify.name,
          source: "project-local",
          manifest: { ...fastify, architectures: ["layered"] },
        },
      ],
    });

    expect(result.checksStatus).toBe("inactive");
    expect(result.selectedSkills).toMatchObject([{ source: "project-entry" }]);
    expect(result.excludedSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "builtin",
          reason: "shadowed-by-override",
        }),
        expect.objectContaining({
          source: "project-local",
          reason: "architecture-mismatch",
        }),
      ]),
    );
  });

  it("records a framework gap instead of choosing rules for another stack", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile,
      scope: "implementation",
      candidates: [
        {
          name: fastify.name,
          source: "global",
          manifest: { ...fastify, architectures: ["layered"] },
        },
        {
          name: "django-policy",
          source: "builtin",
          manifest: {
            ...fastify,
            name: "django-policy",
            language: "Python",
            framework: "Django",
          },
        },
      ],
    });

    expect(result.selectedSkills).toEqual([]);
    expect(result.gaps).toContainEqual(
      expect.objectContaining({
        kind: "incompatible-framework-policy",
        subject: "Fastify",
      }),
    );
    expect(result.architectureRules).not.toHaveLength(0);
  });

  it("TR-008: ranks project-local above project-entry, global and builtin while keeping checksStatus inactive", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");

    // All 4 layers providing the same skill
    const result = composeEffectivePolicy({
      profile,
      scope: "implementation",
      candidates: [
        { name: "test-policy", source: "builtin", manifest: fastify },
        { name: "test-policy", source: "global", manifest: fastify },
        { name: "test-policy", source: "project-entry", manifest: fastify },
        { name: "test-policy", source: "project-local", manifest: fastify },
      ],
    });

    expect(result.checksStatus).toBe("inactive");
    expect(result.selectedSkills).toHaveLength(1);
    expect(result.selectedSkills[0].source).toBe("project-local");
    expect(result.excludedSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "project-entry",
          reason: "shadowed-by-override",
        }),
        expect.objectContaining({
          source: "global",
          reason: "shadowed-by-override",
        }),
        expect.objectContaining({
          source: "builtin",
          reason: "shadowed-by-override",
        }),
      ]),
    );

    // Explicit checksConfigured sets checksStatus to configured
    const configuredResult = composeEffectivePolicy({
      profile,
      candidates: [],
      checksConfigured: true,
    });
    expect(configuredResult.checksStatus).toBe("configured");

    // Explicitly disabled candidate suppresses lower copies
    const disabledResult = composeEffectivePolicy({
      profile,
      candidates: [
        {
          name: "disabled-policy",
          source: "project-local",
          manifest: { ...fastify, disabled: true },
        },
        {
          name: "disabled-policy",
          source: "builtin",
          manifest: fastify,
        },
      ],
    });
    expect(disabledResult.selectedSkills).toHaveLength(0);
    expect(disabledResult.gaps).toEqual([]);
    expect(disabledResult.excludedSkills).toContainEqual(
      expect.objectContaining({
        source: "builtin",
        reason: "shadowed-by-override",
      }),
    );
  });

  it("TR-003: legacy manifests keep their previous scope and missing framework returns explicit gap", async () => {
    const { composeEffectivePolicy, evaluateEnforcementCandidate } =
      await import("./policy-selection.js");

    // Legacy candidate with no scope defined (defaults to 'all')
    const legacyCandidate = {
      name: "legacy-universal",
      source: "global" as const,
      manifest: {
        name: "legacy-universal",
        version: "1.0.0",
        description: "Legacy universal skill",
      },
    };

    // Evaluates as legacy-global-unscoped across scopes
    const evalDefine = evaluateEnforcementCandidate(
      legacyCandidate,
      profile,
      "define",
    );
    expect(evalDefine).toEqual({
      included: true,
      reason: "legacy-global-unscoped",
    });

    const evalImpl = evaluateEnforcementCandidate(
      legacyCandidate,
      profile,
      "implementation",
    );
    expect(evalImpl).toEqual({
      included: true,
      reason: "legacy-global-unscoped",
    });

    const evalReview = evaluateEnforcementCandidate(
      legacyCandidate,
      profile,
      "review",
    );
    expect(evalReview).toEqual({
      included: true,
      reason: "legacy-global-unscoped",
    });

    // Bundled framework guidance suppresses missing-framework-binding gap
    const fastifyResult = composeEffectivePolicy({
      profile,
      candidates: [],
    });
    expect(fastifyResult.frameworkGuidance).toBeDefined();
    expect(fastifyResult.gaps).toEqual([]);

    // Missing framework binding gap when profile specifies framework but no candidates exist
    const noFrameworkResult = composeEffectivePolicy({
      profile: {
        type: "webapp",
        stack: { language: "TypeScript", framework: "Svelte" },
      },
      candidates: [],
    });
    expect(noFrameworkResult.gaps).toContainEqual(
      expect.objectContaining({
        kind: "missing-framework-binding",
        subject: "Svelte",
      }),
    );

    // Missing language binding gap
    const noLanguageResult = composeEffectivePolicy({
      profile: {
        type: "service",
        stack: { language: "Kotlin" },
      },
      candidates: [],
    });
    expect(noLanguageResult.gaps).toContainEqual(
      expect.objectContaining({
        kind: "missing-language-binding",
        subject: "Kotlin",
      }),
    );

    // Unbundled architecture gap
    const unbundledResult = composeEffectivePolicy({
      profile: {
        type: "service",
        design: {
          architecture: "microkernel",
          principles: [],
          templateVersion: "1.0.0",
        },
      },
      candidates: [],
    });
    expect(unbundledResult.gaps).toContainEqual(
      expect.objectContaining({
        kind: "unbundled-architecture",
        subject: "microkernel",
      }),
    );
  });

  it("evaluateEnforcementCandidate reports exact mismatch reasons", async () => {
    const { evaluateEnforcementCandidate } = await import(
      "./policy-selection.js"
    );

    // Scope mismatch
    expect(
      evaluateEnforcementCandidate(
        {
          name: "review-only",
          source: "builtin",
          manifest: { ...fastify, scope: "review" },
        },
        profile,
        "implementation",
      ),
    ).toEqual({ included: false, reason: "scope-mismatch" });

    // Project scope mismatch
    expect(
      evaluateEnforcementCandidate(
        {
          name: "gwrk-only",
          source: "builtin",
          manifest: { ...fastify, projectScope: "gwrk" },
        },
        profile,
        "define",
      ),
    ).toEqual({ included: false, reason: "project-scope-mismatch" });

    // Project scope matches when _isGwrk is true
    expect(
      evaluateEnforcementCandidate(
        {
          name: "gwrk-only",
          source: "builtin",
          manifest: { ...fastify, projectScope: "gwrk" },
        },
        { ...profile, _isGwrk: true },
        "define",
      ),
    ).toEqual({ included: true, reason: "selected" });

    // Language mismatch
    expect(
      evaluateEnforcementCandidate(
        {
          name: "python-only",
          source: "builtin",
          manifest: { ...fastify, language: "Python" },
        },
        profile,
        "define",
      ),
    ).toEqual({ included: false, reason: "language-mismatch" });

    // Framework mismatch
    expect(
      evaluateEnforcementCandidate(
        {
          name: "express-only",
          source: "builtin",
          manifest: { ...fastify, framework: "Express" },
        },
        profile,
        "define",
      ),
    ).toEqual({ included: false, reason: "framework-mismatch" });

    // Architecture mismatch
    expect(
      evaluateEnforcementCandidate(
        {
          name: "clean-only",
          source: "builtin",
          manifest: { ...fastify, architectures: ["clean"] },
        },
        profile,
        "define",
      ),
    ).toEqual({ included: false, reason: "architecture-mismatch" });

    // Principle mismatch
    expect(
      evaluateEnforcementCandidate(
        {
          name: "custom-principles",
          source: "builtin",
          manifest: { ...fastify, principles: ["clean-code" as const] },
        },
        {
          ...profile,
          design: {
            architecture: "hexagonal-functional",
            principles: ["tdd"],
            templateVersion: "1.0.0",
          },
        },
        "define",
      ),
    ).toEqual({ included: false, reason: "principle-mismatch" });

    // Project-local override reason
    expect(
      evaluateEnforcementCandidate(
        {
          name: "local-skill",
          source: "project-local",
          manifest: fastify,
        },
        profile,
        "define",
      ),
    ).toEqual({ included: true, reason: "project-local-override" });
  });
});

describe("reviewed policy coverage regressions", () => {
  it("reports incompatible bundled framework guidance for TypeScript and Django", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile: {
        ...profile,
        stack: { language: "TypeScript", framework: "Django" },
      },
      candidates: [],
    });

    expect(result.frameworkGuidance).toBeUndefined();
    expect(result.gaps).toEqual([
      expect.objectContaining({
        kind: "incompatible-framework-policy",
        subject: "Django",
      }),
    ]);
  });

  it("returns bundled ORM guidance for Python and Django", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile: {
        ...profile,
        stack: { language: "Python", framework: "Django" },
      },
      candidates: [],
    });

    expect(result.frameworkGuidance).toContain("Django ORM");
    expect(result.gaps).toEqual([]);
  });

  it.each([
    { scope: "implementation", projectScope: "any", suppressed: true },
    { scope: "review", projectScope: "any", suppressed: false },
    { scope: "implementation", projectScope: "gwrk", suppressed: false },
  ] as const)(
    "applies a stale disable in $scope with project scope $projectScope",
    async ({ scope, projectScope, suppressed }) => {
      const { composeEffectivePolicy } = await import("./policy-selection.js");
      const manifest = {
        ...fastify,
        name: "svelte-policy",
        framework: "Svelte",
        architectures: ["clean"],
      };
      const global = {
        name: manifest.name,
        source: "global" as const,
        manifest,
      };
      const result = composeEffectivePolicy({
        profile: {
          ...profile,
          stack: { language: "TypeScript", framework: "Svelte" },
          design: { ...profile.design, architecture: "Clean" },
          _isGwrk: false,
        },
        scope,
        candidates: [
          global,
          {
            name: manifest.name,
            source: "project-local",
            manifest: {
              ...manifest,
              scope: "implementation",
              projectScope,
              disabled: true,
              architectures: ["layered"],
            },
          },
        ],
      });

      expect(result.selectedSkills).toEqual(suppressed ? [] : [global]);
      if (suppressed) {
        expect(result.excludedSkills).toContainEqual({
          name: manifest.name,
          source: "global",
          reason: "shadowed-by-override",
        });
      }
      expect(result.gaps).toEqual([]);
    },
  );

  it("returns no language guidance for inherited table keys", async () => {
    const { lookupLanguageGuidance } = await import(
      "./architecture-context.js"
    );
    expect(lookupLanguageGuidance("constructor")).toBeUndefined();
  });

  it("returns no framework guidance for inherited table keys", async () => {
    const { lookupFrameworkGuidance } = await import(
      "./architecture-context.js"
    );
    expect(lookupFrameworkGuidance("con-structor")).toBeUndefined();
  });

  it("reports both binding gaps for unknown language and framework identifiers", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile: {
        ...profile,
        stack: { language: "constructor", framework: "con-structor" },
      },
      candidates: [],
    });

    expect(result.gaps.map(({ kind, subject }) => ({ kind, subject }))).toEqual(
      [
        { kind: "missing-language-binding", subject: "constructor" },
        { kind: "missing-framework-binding", subject: "con-structor" },
      ],
    );
  });

  it.each([
    {
      title: "disabled",
      override: { disabled: true },
      scope: "define",
      framework: "Fastify",
      gap: undefined,
    },
    {
      title: "other workflow",
      override: { scope: "implementation" },
      scope: "define",
      framework: "Fastify",
      gap: undefined,
    },
    {
      title: "other workflow without bundled guidance",
      override: { scope: "implementation" },
      scope: "define",
      framework: "Svelte",
      gap: undefined,
    },
    {
      title: "foreign repository",
      override: { projectScope: "gwrk" },
      scope: "define",
      framework: "Fastify",
      gap: undefined,
    },
    {
      title: "foreign repository without a bundled framework",
      override: { projectScope: "gwrk" },
      scope: "define",
      framework: "Svelte",
      gap: "missing-framework-binding",
    },
    {
      title: "incompatible architecture in another workflow",
      override: { scope: "implementation", architectures: ["layered"] },
      scope: "define",
      framework: "Fastify",
      gap: "incompatible-framework-policy",
    },
  ] as const)(
    "classifies $title framework coverage",
    async ({ override, scope, framework, gap }) => {
      const { composeEffectivePolicy } = await import("./policy-selection.js");
      const result = composeEffectivePolicy({
        profile: { ...profile, stack: { language: "TypeScript", framework } },
        scope,
        candidates: [
          {
            name: fastify.name,
            source: "project-local",
            manifest: {
              ...fastify,
              ...override,
              framework,
              architectures: override.architectures
                ? [...override.architectures]
                : fastify.architectures,
            },
          },
        ],
      });
      expect(result.selectedSkills).toEqual([]);
      expect(result.gaps.map(({ kind }) => kind)).toEqual(gap ? [gap] : []);
    },
  );

  it("reports an incompatible framework policy above a disabled copy", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile,
      candidates: [
        {
          name: fastify.name,
          source: "project-local",
          manifest: { ...fastify, architectures: ["layered"] },
        },
        {
          name: fastify.name,
          source: "global",
          manifest: { ...fastify, disabled: true },
        },
      ],
    });

    expect(result.gaps).toContainEqual(
      expect.objectContaining({
        kind: "incompatible-framework-policy",
        subject: "Fastify",
      }),
    );
  });

  it.each(["review", "define"] as const)(
    "counts the review policy's language and framework bindings in %s",
    async (scope) => {
      const { composeEffectivePolicy } = await import("./policy-selection.js");
      const stack = { language: "Kotlin", framework: "Svelte" };
      const manifest = { ...fastify, ...stack, name: "svelte-policy" };
      const result = composeEffectivePolicy({
        profile: { ...profile, stack },
        scope,
        candidates: [
          {
            name: manifest.name,
            source: "project-local",
            manifest: { ...manifest, scope: "implementation", disabled: true },
          },
          {
            name: manifest.name,
            source: "builtin",
            manifest: { ...manifest, scope: "review" },
          },
        ],
      });

      expect(result.selectedSkills).toEqual(
        scope === "review"
          ? [expect.objectContaining({ source: "builtin" })]
          : [],
      );
      expect(result.gaps).toEqual([]);
    },
  );

  it("reports an incompatible review policy despite a disabled implementation copy", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile,
      scope: "define",
      candidates: [
        {
          name: fastify.name,
          source: "project-local",
          manifest: { ...fastify, scope: "implementation", disabled: true },
        },
        {
          name: fastify.name,
          source: "builtin",
          manifest: { ...fastify, scope: "review", architectures: ["layered"] },
        },
      ],
    });

    expect(result.gaps).toContainEqual(
      expect.objectContaining({
        kind: "incompatible-framework-policy",
        subject: "Fastify",
      }),
    );
  });

  it("rejects an empty architecture selector and accepts an omitted selector", async () => {
    const { evaluateEnforcementCandidate } = await import(
      "./policy-selection.js"
    );
    const cleanProfile = {
      ...profile,
      design: { ...profile.design, architecture: "Clean" },
    };
    const candidate = {
      name: "architecture-policy",
      source: "builtin",
      manifest: {
        name: "architecture-policy",
        version: "1.0.0",
        description: "Architecture policy",
      },
    } as const;

    expect(
      evaluateEnforcementCandidate(
        {
          ...candidate,
          manifest: { ...candidate.manifest, architectures: [] },
        },
        cleanProfile,
        "define",
      ),
    ).toEqual({ included: false, reason: "architecture-mismatch" });
    expect(
      evaluateEnforcementCandidate(candidate, cleanProfile, "define"),
    ).toEqual({ included: true, reason: "selected" });
  });

  it.each([
    {
      stack: { languages: ["Rust", "Go"] },
      wanted: ["Rust", "Go"],
      guidance: "traits",
    },
    {
      stack: { language: "TypeScript", languages: ["JavaScript", "Python"] },
      wanted: ["TypeScript", "JavaScript", "Python"],
      guidance: "interfaces",
    },
  ])(
    "matches every configured language in $stack",
    async ({ stack, wanted, guidance }) => {
      const { composeEffectivePolicy } = await import("./policy-selection.js");
      const result = composeEffectivePolicy({
        profile: { ...profile, stack },
        candidates: wanted.map((language) => ({
          name: language,
          source: "project-entry",
          manifest: {
            name: language,
            version: "1.0.0",
            description: language,
            language,
          },
        })),
      });
      expect(result.selectedSkills.map(({ name }) => name)).toEqual(wanted);
      expect(result.languageGuidance).toContain(guidance);
      expect(result.gaps).toEqual([]);
    },
  );

  it.each([
    { stack: { language: "Kotlin" }, scope: "all" },
    { stack: { languages: ["Rust", "Kotlin"] }, scope: "all" },
    { stack: { languages: ["Rust", "Kotlin"] }, scope: "implementation" },
  ] satisfies Array<{
    stack: ProjectProfile["stack"];
    scope: "all" | "implementation";
  }>)(
    "accepts custom language coverage for $stack in scope $scope",
    async ({ stack, scope }) => {
      const { composeEffectivePolicy } = await import("./policy-selection.js");
      const result = composeEffectivePolicy({
        profile: { ...profile, stack },
        scope: "define",
        candidates: [
          {
            name: "kotlin",
            source: "project-entry",
            manifest: {
              name: "kotlin",
              version: "1.0.0",
              description: "Kotlin ports",
              language: "Kotlin",
              scope,
            },
          },
        ],
      });
      expect(result.selectedSkills).toHaveLength(scope === "all" ? 1 : 0);
      expect(result.gaps).toEqual([]);
    },
  );

  it("reports each uncovered language while ignoring language placeholders", async () => {
    const { composeEffectivePolicy } = await import("./policy-selection.js");
    const result = composeEffectivePolicy({
      profile: {
        ...profile,
        stack: {
          language: "none",
          languages: ["unspecified", "Kotlin", "Elixir", "kotlin"],
        },
      },
      candidates: [],
    });
    expect(result.gaps.map(({ subject }) => subject)).toEqual([
      "Kotlin",
      "Elixir",
    ]);
  });

  it.each([
    ["hexagonal", "Hexagonal-Functional"],
    ["Hexagonal-Functional", "hexagonal"],
    ["hexagonal-with-functional-core", "hexagonal"],
    ["Hexagonal with functional core", "hexagonal"],
  ])(
    "matches profile architecture %s with manifest architecture %s",
    async (architecture, manifestArchitecture) => {
      const { composeEffectivePolicy } = await import("./policy-selection.js");
      const inputProfile = {
        ...profile,
        design: { ...profile.design, architecture },
      };
      const original = JSON.stringify(inputProfile);
      const result = composeEffectivePolicy({
        profile: inputProfile,
        candidates: [
          {
            name: fastify.name,
            source: "project-entry",
            manifest: { ...fastify, architectures: [manifestArchitecture] },
          },
        ],
      });
      expect(result.selectedSkills).toHaveLength(1);
      expect(result.design?.architecture).toBe("hexagonal-functional");
      expect(result.architectureRules).toContain(
        "Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.",
      );
      expect(result.gaps).toEqual([]);
      expect(JSON.stringify(inputProfile)).toBe(original);
    },
  );
});
