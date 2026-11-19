/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { logCliOutput } from "../adapters/cli/output-scope.js";
import { gwrkHome } from "../adapters/config/paths.js";
import { type SeedSkill, parseSeedTaxonomy } from "../domain/seed-taxonomy.js";
import { CommandError } from "../utils/signal.js";
import { AnyManifestSchema } from "./manifest.js";

interface SeedOptions {
  dryRun?: boolean;
  taxonomyPath?: string;
}
async function hasCompleteSkill(directory: string): Promise<boolean> {
  try {
    await fs.stat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const [manifest, markdown] = await Promise.all([
    fs.readFile(path.join(directory, "manifest.yaml"), "utf8"),
    fs.readFile(path.join(directory, "SKILL.md"), "utf8"),
  ]);
  AnyManifestSchema.parse(parse(manifest));
  if (!markdown.trim())
    throw new Error(`Existing skill is incomplete: ${directory}`);
  return true;
}
export async function seedSkills(options: SeedOptions = {}): Promise<void> {
  const cliRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  if (
    options.taxonomyPath !== undefined &&
    options.taxonomyPath.trim() === ""
  ) {
    throw new CommandError(
      "Supply a valid Markdown taxonomy with gwrk plugin seed --taxonomy <path>.",
    );
  }
  const taxonomyFile =
    options.taxonomyPath !== undefined
      ? path.resolve(options.taxonomyPath)
      : path.join(
          cliRoot,
          "docs",
          "archive",
          "reference",
          "reasoning-modes.md",
        );
  let skills: SeedSkill[];
  try {
    skills = parseSeedTaxonomy(await fs.readFile(taxonomyFile, "utf8"));
  } catch (error) {
    throw new CommandError(
      `Cannot read valid taxonomy at ${taxonomyFile}: ${error instanceof Error ? error.message : String(error)}. Supply a valid Markdown taxonomy with gwrk plugin seed --taxonomy <path>.`,
    );
  }
  const skillsRoot = path.join(gwrkHome(), "plugins", "skills");
  for (const skill of skills) {
    const directory = path.join(skillsRoot, skill.name);
    if (options.dryRun) {
      logCliOutput(
        `[DRY RUN] Would seed skill '${skill.name}' (${skill.category}) to ${directory}`,
      );
      continue;
    }
    let temporary: string | undefined;
    try {
      if (await hasCompleteSkill(directory)) continue;
      await fs.mkdir(skillsRoot, { recursive: true });
      temporary = await fs.mkdtemp(path.join(skillsRoot, `.${skill.name}-`));
      const manifest = {
        type: "skill",
        name: skill.name,
        version: "1.0.0",
        description: skill.description,
        tier: "atomic",
        category: skill.category,
        prompt: skill.prompt,
        interface: { input: "stdin", output: "stdout" },
        runtime: { preferredAgent: "agy", preferredModel: "default" },
      };
      AnyManifestSchema.parse(manifest);
      await fs.writeFile(
        path.join(temporary, "manifest.yaml"),
        stringify(manifest),
        { flag: "wx" },
      );
      await fs.writeFile(
        path.join(temporary, "SKILL.md"),
        `# ${skill.name}\n\n${skill.description}\n\n## Prompt\n> "${skill.prompt}"\n`,
        { flag: "wx" },
      );
      try {
        await fs.rename(temporary, directory);
      } catch (error) {
        if (!(await hasCompleteSkill(directory))) throw error;
      }
      logCliOutput(`Seeded skill '${skill.name}' (${skill.category}).`);
    } catch (error) {
      throw new CommandError(
        `Cannot seed skill '${skill.name}' at ${directory}: ${error instanceof Error ? error.message : String(error)}. Inspect the destination and retry gwrk plugin seed --taxonomy ${taxonomyFile}.`,
      );
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
