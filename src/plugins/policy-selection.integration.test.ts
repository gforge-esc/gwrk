/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
    Partial<
      Pick<EnforcementSkillManifest, "framework" | "disabled" | "architectures">
    >,
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
  const frontmatter = "---\r\ndescription: Fixture policy metadata\r\n---";
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

  describe("project settings for a configured policy override", () => {
    const renamedPolicy = "renamed-policy";
    const architecture = "hexagonal-functional";
    const overrideBody = "Configured override policy";
    const entryBody = "Compatible entry policy";
    const disableSettings = [
      { setting: "disable list", config: { disable: [name] } },
      {
        setting: "explicit disable",
        config: { plugins: { [name]: { enabled: false } } },
      },
    ];
    let home: string;

    beforeEach(async ({ onTestFinished }) => {
      home = join(root, "home");
      await mkdir(home);
      const homedir = vi.spyOn(os, "homedir").mockReturnValue(home);
      onTestFinished(() => {
        homedir.mockRestore();
      });
      await writeFile(
        join(root, ".gwrkrc.json"),
        JSON.stringify({
          project: {
            ...profile,
            name: "policy-selection-fixture",
            design: {
              architecture,
              principles: ["functional-core"],
              templateVersion: "1.0.0",
            },
          },
        }),
      );
    });

    async function writeOverrideFixture(
      manifestName: string,
      overrideArchitecture: string,
    ) {
      const override = join(root, "overrides", name);
      await writePolicyPack(
        override,
        {
          name: manifestName,
          framework,
          version: "2.0.0",
          architectures: [overrideArchitecture],
        },
        overrideBody,
      );
      await writePolicyPack(
        join(root, "entry/skills", name),
        { name, framework, version: "1.0.0", architectures: [architecture] },
        entryBody,
      );
      return {
        inherits: false,
        entries: ["entry"],
        override: { [name]: override },
      };
    }

    it.each(disableSettings)(
      "omits both policy bodies with a $setting under the configured name",
      async ({ config }) => {
        const fixture = await writeOverrideFixture(renamedPolicy, architecture);
        await writeFile(
          join(root, ".gwrk/plugins.json"),
          JSON.stringify({ ...fixture, ...config }),
        );

        const rendered = await resolveEnforcementSkills(root);
        expect.soft(rendered).not.toContain(overrideBody);
        expect(rendered).not.toContain(entryBody);
      },
    );

    it("selects the compatible renamed override without project disable settings", async () => {
      const fixture = await writeOverrideFixture(renamedPolicy, architecture);
      await writeFile(
        join(root, ".gwrk/plugins.json"),
        JSON.stringify(fixture),
      );

      const policy = await resolveEffectivePolicy(root);
      expect(
        policy.selectedSkills.filter((skill) => skill.name === name),
      ).toEqual([
        expect.objectContaining({
          source: "project-local",
          manifest: expect.objectContaining({
            name: renamedPolicy,
            version: "2.0.0",
          }),
        }),
      ]);
      const rendered = await resolveEnforcementSkills(root);
      expect
        .soft(rendered)
        .toContain(
          `<!-- enforcement-skill: ${renamedPolicy} -->\n${overrideBody}`,
        );
      expect(rendered).not.toContain(entryBody);

      const listed = await listProjectPlugins(root);
      expect(
        listed.filter((plugin) => [name, renamedPolicy].includes(plugin.name)),
      ).toEqual([
        expect.objectContaining({ name, version: "2.0.0", status: "active" }),
      ]);
    });

    it.each(
      disableSettings.flatMap((setting) =>
        [name, renamedPolicy].map((manifestName) => ({
          ...setting,
          manifestName,
        })),
      ),
    )(
      "lists the disabled incompatible override with a $setting and manifest $manifestName",
      async ({ config, manifestName }) => {
        const fixture = await writeOverrideFixture(manifestName, "layered");
        await writeFile(
          join(root, ".gwrk/plugins.json"),
          JSON.stringify({ ...fixture, ...config }),
        );

        const cli = fileURLToPath(
          new URL("../../dist/cli.js", import.meta.url),
        );
        const result = spawnSync(
          process.execPath,
          [cli, "plugin", "list", "--project", "--format", "json"],
          {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              HOME: home,
              USERPROFILE: home,
              GWRK_HOME: home,
            },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 10_000,
          },
        );
        expect(result.status, result.error?.message ?? result.stderr).toBe(0);
        const listed: PluginSummary[] = JSON.parse(result.stdout);
        expect
          .soft(listed.filter((plugin) => plugin.name === name))
          .toEqual([
            expect.objectContaining({ status: "disabled", version: "2.0.0" }),
          ]);
        expect
          .soft(listed.map((plugin) => plugin.name))
          .not.toContain(renamedPolicy);

        const rendered = await resolveEnforcementSkills(root);
        expect.soft(rendered).not.toContain(overrideBody);
        expect(rendered).not.toContain(entryBody);
      },
    );
  });

  it.each(["", "   \n\t", frontmatter])(
    "reports a framework gap and omits an override with empty instructions %j",
    async (body) => {
      const override = join(root, "overrides", name);
      await writePolicyPack(
        override,
        { name, framework, version: "2.0.0" },
        body,
      );
      await writeFile(
        join(root, ".gwrk/plugins.json"),
        JSON.stringify({ inherits: false, override: { [name]: override } }),
      );
      expect.soft((await resolveEffectivePolicy(root)).gaps).toContainEqual(
        expect.objectContaining({
          kind: "missing-framework-binding",
          subject: framework,
        }),
      );
      expect
        .soft(await resolveEnforcementSkills(root))
        .toContain("## Policy gaps");
      expect(
        (await listProjectPlugins(root)).filter((p) => p.name === name),
      ).toEqual([]);
    },
  );

  it.each([false, true])(
    "preserves lower-layer selection or disabled suppression for architecture-mismatched override (disabled=%s)",
    async (disabled) => {
      await writeFile(
        join(root, ".gwrkrc.json"),
        JSON.stringify({
          project: {
            ...profile,
            design: {
              architecture: "hexagonal-functional",
              principles: ["functional-core"],
              templateVersion: "1.0.0",
            },
          },
        }),
      );
      const override = join(root, "overrides", name);
      await writePolicyPack(
        override,
        {
          name,
          framework,
          version: "2.0.0",
          architectures: ["layered"],
          disabled,
        },
        " ",
      );
      await writePolicyPack(
        join(root, "entry/skills", name),
        {
          name,
          framework,
          version: "1.0.0",
          architectures: ["hexagonal-functional"],
        },
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
      expect(
        (await listProjectPlugins(root)).filter((p) => p.name === name),
      ).toEqual([
        expect.objectContaining({
          status: disabled ? "disabled" : "active",
          version: disabled ? "2.0.0" : "1.0.0",
        }),
      ]);
    },
  );

  it.each([" \n", `${frontmatter}\r\n \t`])(
    "falls back to a usable entry when the override has empty instructions %j",
    async (body) => {
      const override = join(root, "overrides", name);
      await writePolicyPack(
        override,
        { name, framework, version: "2.0.0" },
        body,
      );
      await writePolicyPack(
        join(root, "entry/skills", name),
        { name, framework, version: "1.0.0" },
        `${frontmatter}\r\n\r\nCompatible entry policy`,
      );
      await writeFile(
        join(root, ".gwrk/plugins.json"),
        JSON.stringify({
          inherits: false,
          entries: ["entry"],
          override: { [name]: override },
        }),
      );
      expect
        .soft(await resolveEnforcementSkills(root))
        .toContain("Compatible entry policy");
      expect(
        (await listProjectPlugins(root)).filter((p) => p.name === name),
      ).toEqual([
        expect.objectContaining({ status: "active", version: "1.0.0" }),
      ]);
    },
  );

  it.each([
    { setting: {}, aliasStatus: "active", pathKind: "direct path" },
    { setting: {}, aliasStatus: "active", pathKind: "symbolic link" },
    {
      setting: { disable: [name] },
      aliasStatus: "disabled",
      pathKind: "symbolic link",
    },
    {
      setting: { plugins: { [name]: { enabled: false } } },
      aliasStatus: "disabled",
      pathKind: "symbolic link",
    },
    {
      setting: { disable: [name] },
      aliasStatus: "disabled",
      pathKind: "direct path",
    },
    {
      setting: { plugins: { [name]: { enabled: false } } },
      aliasStatus: "disabled",
      pathKind: "direct path",
    },
  ])(
    "renders a shared pack once with alias status $aliasStatus through a $pathKind under $setting",
    async ({ setting, aliasStatus, pathKind }) => {
      const installed = join(root, "entry/skills/renamed-policy");
      await writePolicyPack(
        installed,
        { name: "renamed-policy", framework, version: "2.0.0" },
        "Installed identity rules",
      );
      let override = installed;
      if (pathKind === "symbolic link") {
        override = join(root, "linked-policy");
        await symlink(installed, override, "dir");
      }
      await writeFile(
        join(root, ".gwrk/plugins.json"),
        JSON.stringify({
          inherits: false,
          entries: ["entry"],
          override: { [name]: override },
          ...setting,
        }),
      );
      const rendered = await resolveEnforcementSkills(root);
      expect.soft(rendered.match(/Installed identity rules/g)).toHaveLength(1);
      expect.soft((await resolveEffectivePolicy(root)).gaps).toEqual([]);
      const listed = (await listProjectPlugins(root)).filter((p) =>
        [name, "renamed-policy"].includes(p.name),
      );
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name,
            version: "2.0.0",
            status: aliasStatus,
          }),
          expect.objectContaining({
            name: "renamed-policy",
            version: "2.0.0",
            status: "active",
          }),
        ]),
      );
      expect(listed).toHaveLength(2);
    },
  );

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
