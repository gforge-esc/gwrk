/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SeedOptions {
  dryRun?: boolean;
}

export async function seedSkills(options: SeedOptions = {}): Promise<void> {
  const globalDir = path.join(os.homedir(), ".gwrk", "plugins");

  // Resolve taxonomy file relative to CLI installation, fallback to cwd()
  const cliRoot = path.resolve(__dirname, "..", "..");
  const taxonomyFile = path.join(
    cliRoot,
    "docs",
    "reference",
    "reasoning-modes.md",
  );

  try {
    const content = await fs.readFile(taxonomyFile, "utf-8");
    const sections = content.split(/\n---\n/);

    for (const section of sections) {
      const lines = section.trim().split("\n");
      if (lines.length === 0) continue;

      const categoryLine = lines[0].trim().toLowerCase();
      // Map "Reasoning Modes" -> "reasoning", "Evaluative Modes" -> "evaluative", etc.
      const category = categoryLine.split(" ")[0];
      if (!category || category === "how") continue; // Skip "How to Use These" section

      // Match: 1. **Name** - Description.
      // Followed by: > "Prompt" (with potential multiple newlines and spaces)
      const modeRegex = /(\d+)\. \*\*([^*]+)\*\* - ([^\n]+)\s+> "([^"]+)"/g;

      for (const execResult of section.matchAll(modeRegex)) {
        const name = execResult[2].toLowerCase().replace(/\s+/g, "-");
        const description = execResult[3];
        const prompt = execResult[4];

        await createAtomicSkill(
          name,
          category,
          description,
          prompt,
          globalDir,
          options,
        );
      }
    }
  } catch (e) {
    console.error("Failed to seed skills:", e);
  }
}

async function createAtomicSkill(
  name: string,
  category: string,
  description: string,
  prompt: string,
  globalDir: string,
  options: SeedOptions,
): Promise<void> {
  const skillDestDir = path.join(globalDir, "skills", name);

  const manifest = {
    type: "skill",
    name,
    version: "1.0.0",
    description,
    tier: "atomic",
    category: category,
    prompt,
    interface: {
      input: "stdin",
      output: "stdout",
    },
    runtime: {
      preferredAgent: "gemini",
      preferredModel: "gemini-2.0-flash",
    },
  };

  const skillMarkdown = `# ${name.charAt(0).toUpperCase() + name.slice(1)}

${description}

## Prompt
> "${prompt}"
`;

  if (options.dryRun) {
    console.log(
      `[DRY RUN] Would seed skill '${name}' (${category}) to ${skillDestDir}`,
    );
    return;
  }

  // Check if destination exists
  try {
    await fs.stat(skillDestDir);
    // console.log(`Skipping existing skill '${name}'`);
    return;
  } catch {
    // Proceed
  }

  try {
    await fs.mkdir(skillDestDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDestDir, "manifest.yaml"),
      stringify(manifest),
    );
    await fs.writeFile(path.join(skillDestDir, "SKILL.md"), skillMarkdown);
    console.log(`Seeded skill '${name}' (${category}).`);
  } catch (e) {
    console.error(`Failed to seed skill '${name}':`, e);
  }
}
