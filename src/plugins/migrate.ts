import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";

const FRONTMATTER_REGEX = /^---\n([\s\S]+?)\n---\n?([\s\S]*)$/;

interface MigrateOptions {
  dryRun?: boolean;
}

export async function migratePlugins(
  options: MigrateOptions = {},
): Promise<void> {
  const projectRoot = process.cwd();
  const globalDir = path.join(os.homedir(), ".gwrk", "plugins");

  // ADR-007: Check for legacy directory and warn
  const agentsDir = path.join(projectRoot, ".agents");
  try {
    const stats = await fs.stat(agentsDir);
    if (stats.isDirectory()) {
      console.warn(
        "\n[DEPRECATED] Legacy '.agents/' directory detected. This directory is no longer supported.",
      );
      console.warn("Please run 'gwrk init' to seed builtin plugins to ~/.gwrk/ and delete '.agents/'.\n");
    }
  } catch {
    // .agents/ missing, this is the desired state for new projects
  }

  // Migrate skills from .agents/skills/
  const skillsDir = path.join(projectRoot, ".agents", "skills");
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await migrateSkill(entry.name, skillsDir, globalDir, options);
      }
    }
  } catch {
    // Skills directory missing, skip
  }

  // Migrate workflows from .agents/workflows/
  const workflowsDir = path.join(projectRoot, ".agents", "workflows");
  try {
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        await migrateWorkflow(entry.name, workflowsDir, globalDir, options);
      }
    }
  } catch {
    // Workflows directory missing, skip
  }
}

// Keep old name as alias for backward compatibility
export const migrateSkills = migratePlugins;

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

    let frontmatter: Record<string, unknown> = {};
    let markdown = content;

    if (match) {
      frontmatter = parse(match[1]);
      markdown = match[2];
    }

    // Prepare manifest
    const manifest: Record<string, unknown> = {
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

async function migrateWorkflow(
  filename: string,
  sourceBase: string,
  destBase: string,
  options: MigrateOptions,
): Promise<void> {
  const name = path.basename(filename, ".md");
  const sourcePath = path.join(sourceBase, filename);
  const workflowDestDir = path.join(destBase, "workflows", name);

  try {
    const content = await fs.readFile(sourcePath, "utf-8");
    const match = content.match(FRONTMATTER_REGEX);

    let description = `Migrated workflow: ${name}`;
    if (match) {
      const frontmatter = parse(match[1]) as Record<string, unknown>;
      if (typeof frontmatter.description === "string") {
        description = frontmatter.description;
      }
    }

    const manifest: Record<string, unknown> = {
      type: "workflow",
      name,
      version: "0.1.0",
      description,
    };

    if (options.dryRun) {
      console.log(
        `[DRY RUN] Would migrate workflow '${name}' to ${workflowDestDir}`,
      );
      return;
    }

    // Check if destination exists
    try {
      await fs.stat(workflowDestDir);
      console.log(`Skipping workflow '${name}' — already installed.`);
      return;
    } catch {
      // Destination does not exist, proceed
    }

    await fs.mkdir(workflowDestDir, { recursive: true });
    await fs.writeFile(
      path.join(workflowDestDir, "manifest.yaml"),
      stringify(manifest),
    );
    await fs.writeFile(path.join(workflowDestDir, `${name}.md`), content);

    console.log(`Migrated workflow '${name}'.`);
  } catch (e) {
    console.error(`Failed to migrate workflow '${name}':`, e);
  }
}
