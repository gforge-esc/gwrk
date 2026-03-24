import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { stringify } from "yaml";

export interface SeedOptions {
  dryRun?: boolean;
}

export async function seedSkills(options: SeedOptions = {}): Promise<void> {
  const projectRoot = process.cwd();
  const globalDir = path.join(os.homedir(), ".gwrk", "plugins");
  const taxonomyFile = path.join(projectRoot, "docs", "reference", "reasoning-modes.md");

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
      
      let match;
      while ((match = modeRegex.exec(section)) !== null) {
        const name = match[2].toLowerCase().replace(/\s+/g, "-");
        const description = match[3];
        const prompt = match[4];

        await createAtomicSkill(name, category, description, prompt, globalDir, options);
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
  options: SeedOptions
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
    console.log(`[DRY RUN] Would seed skill '${name}' (${category}) to ${skillDestDir}`);
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
    await fs.writeFile(path.join(skillDestDir, "manifest.yaml"), stringify(manifest));
    await fs.writeFile(path.join(skillDestDir, "SKILL.md"), skillMarkdown);
    console.log(`Seeded skill '${name}' (${category}).`);
  } catch (e) {
    console.error(`Failed to seed skill '${name}':`, e);
  }
}
