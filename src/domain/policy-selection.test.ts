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
      profile: {
        type: "webapp",
        stack: { language: "TypeScript", framework: "Fastify" },
      },
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
