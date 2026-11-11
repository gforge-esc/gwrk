/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parse } from "yaml";
import type { ProjectProfile } from "../domain/types.js";
import { SkillManifestSchema } from "./manifest.js";

// Framework selectors come from gwrk-plugins commit df5eaa2.
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

const frameworkCandidates = frameworkPacks.map(
  ([name, language, framework]) => ({
    name,
    source: "project-entry" as const,
    manifest: parseEnforcementManifest({
      type: "skill",
      name,
      version: "1.1.0",
      description: `${framework} coding standards`,
      tier: "enforcement",
      scope: "all",
      language,
      framework,
    }),
  }),
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
    const { composeEffectivePolicy } = await import(
      "../domain/policy-selection.js"
    );
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
  const { composeEffectivePolicy } = await import(
    "../domain/policy-selection.js"
  );
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
