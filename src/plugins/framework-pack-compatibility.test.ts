/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";
import { composeEffectivePolicy } from "../domain/policy-selection.js";
import type { ProjectProfile } from "../domain/types.js";
import { SkillManifestSchema } from "./manifest.js";

const frameworkPacks = [
  ["axum-standards", "Rust", "Axum"],
  ["chi-standards", "Go", "Chi"],
  ["clap-standards", "Rust", "Clap"],
  ["django-standards", "Python", "Django"],
  ["express-standards", "TypeScript", "Express"],
  ["fastapi-standards", "Python", "FastAPI"],
  ["fastify-standards", "TypeScript", "Fastify"],
  ["gin-standards", "Go", "Gin"],
  ["nextjs-standards", "TypeScript", "Next.js"],
  ["react-standards", "TypeScript", "React"],
] as const;

const design = {
  architecture: "hexagonal-functional",
  principles: ["functional-core", "clean-code", "tdd"],
  templateVersion: "1.0.0",
} satisfies NonNullable<ProjectProfile["design"]>;

function parseEnforcementManifest(manifest: unknown) {
  const parsed = SkillManifestSchema.parse(manifest);
  if (parsed.tier !== "enforcement") {
    throw new Error(`Expected an enforcement manifest for ${parsed.name}`);
  }
  return parsed;
}

// Verbatim skills/*/manifest.yaml from gforge-esc/gwrk-plugins at df5eaa208f360fc9d13a3748e5e92a1c97582231.
const frameworkManifests = `type: skill
name: axum-standards
version: 1.1.0
description: Rust Axum extractor ordering, shared state, and IntoResponse error standards
tier: enforcement
scope: all
language: Rust
framework: Axum
tags:
  - axum
  - rust
  - api
---
type: skill
name: chi-standards
version: 1.1.0
description: Go Chi stdlib HTTP handler composition, middleware, and context standards
tier: enforcement
scope: all
language: Go
framework: Chi
tags:
  - chi
  - go
  - api
---
type: skill
name: clap-standards
version: 1.1.0
description: Rust Clap derive subcommand, exit code, and output stream standards
tier: enforcement
scope: all
language: Rust
framework: Clap
tags:
  - clap
  - rust
  - cli
---
type: skill
name: django-standards
version: 1.1.0
description: Django ORM query hygiene, service boundaries, and migration standards
tier: enforcement
scope: all
language: Python
framework: Django
tags:
  - django
  - python
  - orm
---
type: skill
name: express-standards
version: 1.1.0
description: Express middleware ordering, request validation, and error handling standards
tier: enforcement
scope: all
language: TypeScript
framework: Express
tags:
  - express
  - typescript
  - api
---
type: skill
name: fastapi-standards
version: 1.1.0
description: FastAPI Pydantic v2 validation, dependency injection, and async route standards
tier: enforcement
scope: all
language: Python
framework: FastAPI
tags:
  - fastapi
  - python
  - api
---
type: skill
name: fastify-standards
version: 1.1.0
description: Fastify plugin encapsulation, schema validation, and lifecycle standards
tier: enforcement
scope: all
language: TypeScript
framework: Fastify
tags:
  - fastify
  - typescript
  - api
---
type: skill
name: gin-standards
version: 1.1.0
description: Go Gin HTTP handler binding, context propagation, and error standards
tier: enforcement
scope: all
language: Go
framework: Gin
tags:
  - gin
  - go
  - api
---
type: skill
name: nextjs-standards
version: 1.1.0
description: Next.js App Router and Server Component enforcement standards
tier: enforcement
scope: all
language: TypeScript
framework: Next.js
tags:
  - nextjs
  - react
  - typescript
---
type: skill
name: react-standards
version: 1.1.0
description: React component composition, state, and accessibility enforcement standards
tier: enforcement
scope: all
language: TypeScript
framework: React
tags:
  - react
  - typescript
  - ui
`;

const frameworkCandidates = parseAllDocuments(frameworkManifests).map(
  (document) => {
    const manifest = parseEnforcementManifest(document.toJS());
    return { name: manifest.name, source: "project-entry" as const, manifest };
  },
);

async function languageBaseline(language: string) {
  const name = `${language.toLowerCase()}-standards`;
  const manifest = await readFile(
    new URL(`./builtins/skills/${name}/manifest.yaml`, import.meta.url),
    "utf8",
  );
  return {
    name,
    source: "builtin" as const,
    manifest: parseEnforcementManifest(parse(manifest)),
  };
}

it.each(frameworkPacks)(
  "composes %s with %s and the selected architecture",
  async (name, language, framework) => {
    const baseline = await languageBaseline(language);
    const result = composeEffectivePolicy({
      profile: { type: "webapp", stack: { language, framework }, design },
      scope: "implementation",
      candidates: [baseline, ...frameworkCandidates],
    });
    expect(result.design).toEqual(design);
    expect(result.architectureRules).not.toHaveLength(0);
    expect(result.selectedSkills.map((skill) => skill.name).sort()).toEqual(
      [name, baseline.name].sort(),
    );
    expect(result.gaps).toEqual([]);
  },
);

it("combines the JavaScript baseline with the selected architecture", async () => {
  const baseline = await languageBaseline("JavaScript");
  const result = composeEffectivePolicy({
    profile: { type: "nodejs", stack: { language: "JavaScript" }, design },
    scope: "implementation",
    candidates: [baseline, ...frameworkCandidates],
  });
  expect(result.design).toEqual(design);
  expect(result.selectedSkills.map((skill) => skill.name)).toEqual([
    baseline.name,
  ]);
  expect(result.gaps).toEqual([]);
});

it("reports a gap when the selected language has no compatible framework policy", async () => {
  const baseline = await languageBaseline("Python");
  const result = composeEffectivePolicy({
    profile: {
      type: "webapp",
      stack: { language: "Python", framework: "Express" },
      design,
    },
    candidates: [baseline, ...frameworkCandidates],
  });
  expect(result.selectedSkills.map(({ name }) => name)).toEqual([
    "python-standards",
  ]);
  expect(result.frameworkGuidance).toBeUndefined();
  expect(result.gaps).toContainEqual(
    expect.objectContaining({
      kind: "incompatible-framework-policy",
      subject: "Express",
    }),
  );
});

it("reports missing bindings for an unbundled stack", () => {
  const result = composeEffectivePolicy({
    profile: {
      type: "webapp",
      stack: { language: "Ruby", framework: "Rails" },
      design,
    },
    candidates: frameworkCandidates,
  });
  expect(result.selectedSkills).toEqual([]);
  expect(result.gaps.map(({ kind, subject }) => [kind, subject])).toEqual([
    ["missing-language-binding", "Ruby"],
    ["missing-framework-binding", "Rails"],
  ]);
});
