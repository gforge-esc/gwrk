import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";

const FRONTMATTER_REGEX = /^---\n([\s\S]+?)\n---\n?([\s\S]*)$/;

export interface MigrateOptions {
  dryRun?: boolean;
}

export async function migrateSkills(
  options: MigrateOptions = {},
): Promise<void> {
  const projectRoot = process.cwd();
  const globalDir = path.join(os.homedir(), ".gwrk", "plugins");
  const skillsDir = path.join(projectRoot, ".agents", "skills");

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await migrateSkill(entry.name, skillsDir, globalDir, options);
      }
    }
  } catch (e) {
    // Skills directory missing, skip
  }
}

async function migrateSkill(
  name: string,
  sourceBase: string,
  destBase: string,
  options: MigrateOptions,
): Promise<void> {
  const skillSourceDir = path.join(sourceBase, name);
  const skillDestDir = path.join(destBase, "skills", name);
  const skillFile = path.join(skillSourceDir, "SKILL.md");

  try {
    const content = await fs.readFile(skillFile, "utf-8");
    const match = content.match(FRONTMATTER_REGEX);

    let frontmatter: any = {};
    let markdown = content;

    if (match) {
      frontmatter = parse(match[1]);
      markdown = match[2];
    }

    // Prepare manifest
    const manifest: any = {
      type: "skill",
      name: frontmatter.name || name,
      version: frontmatter.version || "0.1.0",
      description: frontmatter.description || "Migrated skill",
      tier: frontmatter.tier || "atomic", // Default to atomic if not specified
      category: frontmatter.category || "reasoning",
    };

    if (manifest.tier === "atomic") {
      manifest.prompt = frontmatter.prompt || markdown.trim().substring(0, 500); // Rough default
      manifest.interface = {
        input: "stdin",
        output: "stdout",
      };
      manifest.runtime = {
        preferredAgent: "gemini",
        preferredModel: "gemini-2.0-flash",
      };
    } else {
      // Compound
      manifest.composes = frontmatter.composes || [];
      manifest.passes = frontmatter.passes || [];
      manifest.interface = {
        input: "stdin",
        output: "stdout",
      };
      manifest.context = {
        required: ["input"],
        optional: [],
      };
      manifest.runtime = {
        preferredAgent: "gemini",
        preferredModel: "gemini-2.0-flash",
      };
    }

    if (options.dryRun) {
      console.log(`[DRY RUN] Would migrate skill '${name}' to ${skillDestDir}`);
      return;
    }

    // Check if destination exists
    try {
      await fs.stat(skillDestDir);
      console.log(`Skipping '${name}' — already installed.`);
      return;
    } catch {
      // Destination does not exist, proceed
    }

    // Create destination directory
    await fs.mkdir(skillDestDir, { recursive: true });

    // Write manifest.yaml
    await fs.writeFile(
      path.join(skillDestDir, "manifest.yaml"),
      stringify(manifest),
    );

    // Write SKILL.md (preserving the original content)
    await fs.writeFile(path.join(skillDestDir, "SKILL.md"), content);

    console.log(`Migrated skill '${name}'.`);
  } catch (e) {
    console.error(`Failed to migrate skill '${name}':`, e);
  }
}
