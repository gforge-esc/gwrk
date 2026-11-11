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
});
