/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { AnyManifestSchema } from "./manifest.js";
import { seedSkills } from "./seed.js";
let root: string;
let taxonomyPath: string;
const taxonomy =
  'Reasoning Modes\n\n1. **Analytical** - Break down structure.\n    > "ANALYZE THIS"\n\n---\n\nEvaluative Modes\n\n1. **Adversarial** - Attack the idea.\n    > "ATTACK THIS"\n';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-seed-"));
  vi.stubEnv("GWRK_HOME", path.join(root, ".gwrk"));
  taxonomyPath = path.join(root, "taxonomy.md");
  await fs.writeFile(taxonomyPath, taxonomy);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
const skillsRoot = () => path.join(root, ".gwrk/plugins/skills");
it("seeds schema-valid skills with their taxonomy categories from an explicit path", async () => {
  await seedSkills({ taxonomyPath });
  expect((await fs.readdir(skillsRoot())).sort()).toEqual([
    "adversarial",
    "analytical",
  ]);
  for (const [name, category] of [
    ["analytical", "reasoning"],
    ["adversarial", "evaluative"],
  ]) {
    const manifest = parse(
      await fs.readFile(path.join(skillsRoot(), name, "manifest.yaml"), "utf8"),
    );
    expect(AnyManifestSchema.parse(manifest)).toMatchObject({ name, category });
    expect(
      await fs.readFile(path.join(skillsRoot(), name, "SKILL.md"), "utf8"),
    ).toContain(manifest.prompt);
  }
});
it.each(["missing", "invalid", "traversal", "duplicate", "partial"])(
  "rejects %s taxonomy before writes with a repair hint",
  async (kind) => {
    if (kind === "missing") await fs.rm(taxonomyPath);
    if (kind === "invalid") await fs.writeFile(taxonomyPath, "not a taxonomy");
    if (kind === "traversal")
      await fs.writeFile(
        taxonomyPath,
        taxonomy.replace("Analytical", "../outside"),
      );
    if (kind === "duplicate")
      await fs.writeFile(
        taxonomyPath,
        taxonomy.replace("Adversarial", "Analytical"),
      );
    if (kind === "partial")
      await fs.writeFile(
        taxonomyPath,
        `${taxonomy}\n2. **Broken** - Missing prompt.\n`,
      );
    await expect(seedSkills({ taxonomyPath })).rejects.toThrow(
      /taxonomy.*--taxonomy|--taxonomy.*taxonomy/i,
    );
    await expect(fs.stat(skillsRoot())).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it("validates dry runs without creating skill directories", async () => {
  await seedSkills({ taxonomyPath, dryRun: true });
  await expect(fs.stat(skillsRoot())).rejects.toMatchObject({ code: "ENOENT" });
});
it("preserves a complete existing skill byte for byte", async () => {
  await seedSkills({ taxonomyPath });
  const markdown = path.join(skillsRoot(), "analytical/SKILL.md");
  await fs.writeFile(markdown, "Maintainer version\n");
  await seedSkills({ taxonomyPath });
  expect(await fs.readFile(markdown, "utf8")).toBe("Maintainer version\n");
});
it("removes partial publication after a write failure so retry can finish", async () => {
  const write = fs.writeFile.bind(fs);
  const fault = vi
    .spyOn(fs, "writeFile")
    .mockImplementation(async (file, data, options) => {
      if (String(file).endsWith("SKILL.md"))
        throw new Error("fixture write denied");
      return write(file, data, options);
    });
  await expect(seedSkills({ taxonomyPath })).rejects.toThrow(/analytical/);
  expect(await fs.readdir(skillsRoot())).toEqual([]);
  fault.mockRestore();
  await seedSkills({ taxonomyPath });
  expect(
    await fs.readFile(path.join(skillsRoot(), "analytical/SKILL.md"), "utf8"),
  ).toContain("ANALYZE THIS");
});

it("honors a configured gwrk home without writing into the default home", async () => {
  const configuredHome = path.join(root, "configured-home");
  vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "fallback-home"));
  vi.stubEnv("GWRK_HOME", configuredHome);
  await seedSkills({ taxonomyPath });
  expect(
    (await fs.readdir(path.join(configuredHome, "plugins/skills"))).sort(),
  ).toEqual(["adversarial", "analytical"]);
  await expect(fs.stat(path.join(root, ".gwrk"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("seeds the default repository taxonomy including apostrophe names", async () => {
  await seedSkills();
  const seeded = (await fs.readdir(skillsRoot())).sort();
  expect(seeded).toHaveLength(45);
  expect(seeded).toContain("devils-advocate");
  const manifest = parse(
    await fs.readFile(
      path.join(skillsRoot(), "devils-advocate", "manifest.yaml"),
      "utf8",
    ),
  );
  expect(AnyManifestSchema.parse(manifest)).toMatchObject({
    name: "devils-advocate",
    category: "persona",
  });
});

it("rejects empty explicit taxonomy paths without falling back to the default taxonomy", async () => {
  const error = await seedSkills({ taxonomyPath: "" }).catch((err) => err);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain("--taxonomy");
  expect(error.message).not.toContain("reasoning-modes.md");
  await expect(fs.stat(skillsRoot())).rejects.toMatchObject({
    code: "ENOENT",
  });
});
