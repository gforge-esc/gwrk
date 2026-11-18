/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { stringify } from "yaml";
import { runWithOutputScope } from "../adapters/cli/output-scope.js";
import { createPluginCommand, listPlugins } from "../commands/plugin.js";
import type { ProjectProfile } from "../domain/types.js";
import type { PluginSummary } from "./loader.js";
import type { EnforcementSkillManifest } from "./manifest.js";
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

async function writePolicyPack(
  directory: string,
  manifest: Pick<EnforcementSkillManifest, "name" | "version"> &
    Partial<Pick<EnforcementSkillManifest, "framework" | "disabled">>,
  body?: string,
) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "manifest.yaml"),
    stringify({
      type: "skill",
      tier: "enforcement",
      description: "Fixture enforcement policy",
      scope: "all",
      language: "TypeScript",
      ...manifest,
    }),
  );
  if (body !== undefined) await writeFile(join(directory, "SKILL.md"), body);
}

async function listProjectPlugins(
  projectRoot: string,
): Promise<PluginSummary[]> {
  const originalCwd = process.cwd();
  let stdout = "";
  let stderr = "";
  const output = {
    agentMode: false,
    exitCode: 0,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    },
  };
  try {
    process.chdir(projectRoot);
    await runWithOutputScope(output, () =>
      createPluginCommand().parseAsync(
        ["list", "--project", "--format", "json"],
        {
          from: "user",
        },
      ),
    );
    expect(output.exitCode, stderr).toBe(0);
    return JSON.parse(stdout);
  } finally {
    process.chdir(originalCwd);
  }
}

describe("project enforcement candidate discovery", () => {
  const framework = "Fixture Framework";
  const name = "fixture-framework-policy";
  const profile: ProjectProfile = {
    type: "nodejs",
    stack: { language: "TypeScript", framework },
  };
  let root: string;

  beforeEach(async ({ onTestFinished }) => {
    root = await mkdtemp(join(tmpdir(), "gwrk-policy-discovery-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, ".gwrk"));
    await writeFile(
      join(root, ".gwrkrc.json"),
      JSON.stringify({ project: profile }),
    );
  });

  it.each(["relative", "absolute"] as const)(
    "resolves the %s project override when the caller is outside the project",
    async (pathKind) => {
      const home = join(root, "home");
      const homedir = vi.spyOn(os, "homedir").mockReturnValue(home);
      onTestFinished(() => {
        homedir.mockRestore();
      });
      const override = "./overrides/fixture-relative-override";
      const overrideDir = join(root, override);
      await writePolicyPack(
        join(home, ".gwrk/plugins/skills", name),
        { name, framework, version: "1.0.0" },
        "Installed policy",
      );
      await writePolicyPack(
        overrideDir,
        { name, framework, version: "2.0.0" },
        "Project override policy",
      );
      await writeFile(
        join(root, ".gwrk/plugins.json"),
        JSON.stringify({
          override: {
            [name]: pathKind === "relative" ? override : overrideDir,
          },
        }),
      );

      const rendered = await resolveEnforcementSkills(root);
      expect.soft(rendered).toContain("Project override policy");
      expect.soft(rendered).not.toContain("Installed policy");
      const policy = await resolveEffectivePolicy(root);
      expect(
        policy.selectedSkills.find((skill) => skill.name === name),
      ).toMatchObject({
        source: "project-local",
        manifest: { version: "2.0.0" },
      });
    },
  );

  it("reports a framework gap and omits the pack from the CLI when its skill body is missing", async () => {
    await writePolicyPack(join(root, ".gwrk/plugins/skills", name), {
      name,
      framework,
      version: "1.0.0",
    });
    await writeFile(
      join(root, ".gwrk/plugins.json"),
      JSON.stringify({ inherits: false }),
    );

    const policy = await resolveEffectivePolicy(root);
    expect.soft(policy.gaps).toContainEqual(
      expect.objectContaining({
        kind: "missing-framework-binding",
        subject: framework,
      }),
    );
    expect
      .soft(await resolveEnforcementSkills(root))
      .toContain("## Policy gaps");
    expect(
      (await listProjectPlugins(root)).map((plugin) => plugin.name),
    ).not.toContain(name);
  });

  it.each([
    { disabled: false, status: "active", version: "1.0.0" },
    { disabled: true, status: "disabled", version: "2.0.0" },
  ] as const)(
    "lists the $status policy when the override has no skill body",
    async ({ disabled, status, version }) => {
      const override = join(root, "overrides", name);
      await writePolicyPack(override, {
        name,
        framework,
        version: "2.0.0",
        disabled,
      });
      await writePolicyPack(
        join(root, "entry/skills", name),
        { name, framework, version: "1.0.0" },
        "Compatible entry policy",
      );
      await writeFile(
        join(root, ".gwrk/plugins.json"),
        JSON.stringify({
          inherits: false,
          entries: ["entry"],
          override: { [name]: override },
        }),
      );

      const rendered = await resolveEnforcementSkills(root);
      expect.soft(rendered.includes("Compatible entry policy")).toBe(!disabled);
      expect(
        (await listProjectPlugins(root)).filter(
          (plugin) => plugin.name === name,
        ),
      ).toEqual([expect.objectContaining({ status, version })]);
    },
  );
});
