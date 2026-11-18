/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { stringify } from "yaml";
import { listPlugins } from "../commands/plugin.js";
import type { ProjectProfile } from "../domain/types.js";
import type { PluginSummary } from "./loader.js";
import {
  resolveEffectivePolicy,
  resolveEnforcementSkills,
} from "./skill-runtime.js";

it("resolves a compatible lower layer when the local policy selects another architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwrk-policy-layers-"));
  const originalCwd = process.cwd();
  try {
    const name = "fixture-layout-policy";
    const local = join(root, ".gwrk/plugins/skills", name);
    const entry = join(root, "entry/skills", name);
    for (const [directory, architecture, version, content] of [
      [local, "layered", "2.0.0", "Wrong local layout"],
      [entry, "hexagonal-functional", "1.0.0", "Compatible entry layout"],
    ]) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "manifest.yaml"),
        stringify({
          type: "skill",
          name,
          version,
          description: "Fixture architecture policy",
          tier: "enforcement",
          scope: "all",
          language: "TypeScript",
          architectures: [architecture],
        }),
      );
      await writeFile(join(directory, "SKILL.md"), content);
    }
    await writeFile(
      join(root, ".gwrk/plugins.json"),
      JSON.stringify({ inherits: false, entries: ["entry"] }),
    );
    const profile: ProjectProfile = {
      type: "nodejs",
      stack: { language: "TypeScript" },
      design: {
        architecture: "hexagonal-functional",
        principles: ["functional-core", "clean-code", "tdd"],
        templateVersion: "1.0.0",
      },
    };
    const rendered = await resolveEnforcementSkills(root, "all", profile);
    expect(rendered).toContain("Compatible entry layout");
    expect(rendered).not.toContain("Wrong local layout");

    const policy = await resolveEffectivePolicy(root, { profile });
    expect(policy.excludedSkills).toContainEqual({
      name,
      source: "project-local",
      reason: "architecture-mismatch",
    });

    await writeFile(
      join(root, ".gwrkrc.json"),
      JSON.stringify({ project: profile }),
    );
    process.chdir(root);
    const listed: PluginSummary[] = JSON.parse(
      await listPlugins({ format: "json", project: true, tier: "enforcement" }),
    );
    expect(listed.filter((plugin) => plugin.name === name)).toEqual([
      expect.objectContaining({ version: "1.0.0", status: "active" }),
    ]);
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
});
