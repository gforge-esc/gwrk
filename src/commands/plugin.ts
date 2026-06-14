import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { parse, stringify } from "yaml";
import {
  ManifestValidationError,
  PluginLoader,
  PluginNotFoundError,
} from "../plugins/loader.js";
import { AnyManifestSchema, type PluginBase, type SkillManifest } from "../plugins/manifest.js";
import { detectProfile } from "../engine/profile-detector.js";
import { migrateSkills } from "../plugins/migrate.js";
import { seedSkills } from "../plugins/seed.js";
import { color } from "../utils/format.js";
import { withSignal } from "../utils/signal.js";
import { syncContextCommand } from "./sync-context.js";

const { BOLD, DIM, CYAN, GREEN, YELLOW, RED, RESET } = color;

/**
 * FR-001: Install a plugin from a local path.
 */
export async function installPlugin(
  sourcePath: string,
  options: { force?: boolean } = {},
) {
  const manifestPath = path.join(sourcePath, "manifest.yaml");
  let rawManifest: string;
  try {
    rawManifest = await fs.readFile(manifestPath, "utf-8");
  } catch (e) {
    throw new Error(
      `No manifest.yaml found in ${sourcePath}. A valid plugin requires manifest.yaml.`,
    );
  }

  const parsed = parse(rawManifest);
  const result = AnyManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestValidationError(
      path.basename(sourcePath),
      result.error.message,
    );
  }

  const manifest = result.data as PluginBase;
  const globalDir = path.join(os.homedir(), ".gwrk", "plugins");
  const targetTypeDir =
    manifest.type === "skill"
      ? "skills"
      : manifest.type === "agent"
        ? "agents"
        : manifest.type === "workflow"
          ? "workflows"
          : `${manifest.type}s`;

  const targetDir = path.join(globalDir, targetTypeDir, manifest.name);

  let stats: import("fs").Stats | undefined;
  try {
    stats = await fs.stat(targetDir);
  } catch (e: unknown) {
    // Ignore ENOENT
  }

  if (stats?.isDirectory() && !options.force) {
    throw new Error(
      `Plugin '${manifest.name}' already installed. Use --force to overwrite.`,
    );
  }

  await fs.mkdir(targetDir, { recursive: true });

  // Copy all files from source to target
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const src = path.join(sourcePath, entry.name);
    const dest = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      // Simple recursive copy (not exhaustive, but enough for most plugins)
      await fs.mkdir(dest, { recursive: true });
      const subEntries = await fs.readdir(src);
      for (const sub of subEntries) {
        await fs.copyFile(path.join(src, sub), path.join(dest, sub));
      }
    } else {
      await fs.copyFile(src, dest);
    }
  }

  return manifest;
}

/**
 * FR-004: Remove an installed plugin.
 */
export async function removePlugin(
  name: string,
  options: { force?: boolean } = {},
) {
  const loader = new PluginLoader();
  const plugin = await loader.resolvePlugin(name);

  // Dependency check (FR-004)
  if (
    plugin.manifest.type === "skill" &&
    (plugin.manifest as unknown as Record<string, unknown>).tier === "atomic" &&
    !options.force
  ) {
    const allPlugins = await loader.listPlugins();
    const dependents = allPlugins.filter(
      (p) =>
        p.tier === "compound" &&
        (p as unknown as Record<string, string[]>).composes?.includes(name),
    );
    if (dependents.length > 0) {
      throw new Error(
        `Warning: '${dependents[0].name}' depends on '${name}'. Use --force to remove anyway.`,
      );
    }
  }

  await fs.rm(plugin.path, { recursive: true });
  return plugin.manifest;
}

/**
 * FR-003: List installed plugins.
 */
export async function listPlugins(
  options: {
    format?: string;
    project?: boolean;
    type?: string;
    tier?: string;
    category?: string;
  } = {},
) {
  const projectRoot = options.project ? process.cwd() : undefined;
  const loader = new PluginLoader({
    projectDir: projectRoot,
  });
  let plugins = await loader.listPlugins({
    includeDisabled: options.project,
    type: options.type,
    tier: options.tier,
    category: options.category,
  });

  // Filter by profile language if --project is used (Phase 15 requirement)
  if (options.project) {
    const profile = await detectProfile(projectRoot!);
    if (profile.stack?.language) {
      const lang = profile.stack.language.toLowerCase();

      // We need the full manifest to check the language field
      const filtered: PluginSummary[] = [];
      for (const p of plugins) {
        try {
          const loaded = await loader.resolvePlugin(p.name);
          const manifest = loaded.manifest as any;

          if (
            manifest.type === "skill" &&
            manifest.tier === "enforcement" &&
            manifest.language
          ) {
            const manifestLang = manifest.language.toLowerCase();
            if (profile.stack.languages && profile.stack.languages.length > 1) {
              const profileLangs = profile.stack.languages.map((l) =>
                l.toLowerCase(),
              );
              if (!profileLangs.includes(manifestLang)) continue;
            } else if (manifestLang !== lang) {
              continue;
            }
          }
          filtered.push(p);
        } catch {
          filtered.push(p);
        }
      }
      plugins = filtered;
    }
  }

  if (options.format === "json") {
    return JSON.stringify(plugins, null, 2);
  }

  let out = "";
  const grouped = plugins.reduce(
    (acc, p) => {
      const type = `${p.type}s`;
      if (!acc[type]) acc[type] = [];
      acc[type].push(p);
      return acc;
    },
    {} as Record<string, typeof plugins>,
  );

  for (const [type, list] of Object.entries(grouped)) {
    out += `\n${BOLD}${CYAN}${type.toUpperCase()}${RESET}\n`;
    for (const p of list) {
      const status = p.status === "disabled" ? ` ${RED}(disabled)${RESET}` : "";
      const tier = p.tier ? ` ${DIM}[${p.tier}]${RESET}` : "";
      out += `  ${GREEN}${p.name.padEnd(20)}${RESET}${tier} v${p.version}${status}\n`;
      out += `    ${DIM}${p.description}${RESET}\n`;
    }
  }
  return out || "No plugins installed.";
}

/**
 * FR-005: Disable/Enable a plugin per project.
 */
export async function togglePlugin(name: string, enabled: boolean) {
  const projectRoot = process.cwd();
  const configDir = path.join(projectRoot, ".gwrk");
  const configPath = path.join(configDir, "plugins.yaml");

  // Check if in a gwrk project
  if (!fs.stat(path.join(projectRoot, ".gwrkrc.json")).catch(() => null)) {
    throw new Error(
      "Not a gwrk project. Run 'gwrk init' to add gwrk to this project.",
    );
  }

  // Resolve plugin to check type
  const loader = new PluginLoader();
  const plugin = await loader.resolvePlugin(name);

  if (plugin.manifest.type === "skill" || plugin.manifest.type === "agent") {
    if (!enabled)
      throw new Error(
        `${plugin.manifest.type === "skill" ? "Skills" : `${plugin.manifest.type}s`} are global-only and cannot be disabled per-project.`,
      );
  }

  await fs.mkdir(configDir, { recursive: true });
  let config: { disable?: string[]; override?: Record<string, string> } = {};
  try {
    const content = await fs.readFile(configPath, "utf-8");
    config = parse(content) || {};
  } catch (e) {}

  if (!config.disable) config.disable = [];

  const fullName = `${plugin.manifest.type}s/${plugin.manifest.name}`;
  if (enabled) {
    config.disable = config.disable.filter((n) => n !== name && n !== fullName);
  } else {
    if (!config.disable.includes(fullName)) {
      config.disable.push(fullName);
    }
  }

  if (
    config.disable.length === 0 &&
    (!config.override || Object.keys(config.override).length === 0)
  ) {
    await fs.rm(configPath).catch(() => null);
  } else {
    await fs.writeFile(configPath, stringify(config), "utf-8");
  }
}

/**
 * Plugin Command definition
 */
export const pluginCommand = new Command("plugin")
  .description("Manage gwrk plugins (skills, agents, workflows)")
  .addCommand(
    new Command("install")
      .description("Install a plugin from a local path")
      .argument("<path>", "Path to the plugin directory")
      .option("-f, --force", "Overwrite if already installed")
      .action(async (sourcePath, options) => {
        await withSignal("plugin install", async () => {
          const manifest = await installPlugin(sourcePath, options);
          console.log(`${GREEN}Installed plugin '${manifest.name}'.${RESET}`);
        });
      }),
  )
  .addCommand(
    new Command("remove")
      .description("Remove an installed plugin")
      .argument("<name>", "Name of the plugin")
      .option("-f, --force", "Remove even if dependencies exist")
      .action(async (name, options) => {
        await withSignal("plugin remove", async () => {
          const manifest = await removePlugin(name, options);
          console.log(`${GREEN}Removed plugin '${manifest.name}'.${RESET}`);
        });
      }),
  )
  .addCommand(
    new Command("list")
      .description("List installed plugins")
      .option("--format <type>", "Output format (json)")
      .option("--project", "Show resolution for current project")
      .option("--type <type>", "Filter by plugin type (agent, skill, workflow, extension, review)")
      .option("--tier <tier>", "Filter by tier (atomic, compound, enforcement)")
      .option("--category <cat>", "Filter by category (reasoning, evaluative, etc.)")
      .action(async (options) => {
        await withSignal("plugin list", async () => {
          const output = await listPlugins(options);
          console.log(output);
        });
      }),
  )
  .addCommand(
    new Command("disable")
      .description("Disable a plugin in the current project")
      .argument("<name>", "Name of the plugin")
      .action(async (name) => {
        await withSignal("plugin disable", async () => {
          await togglePlugin(name, false);
          console.log(
            `${GREEN}Disabled plugin '${name}' for this project.${RESET}`,
          );
        });
      }),
  )
  .addCommand(
    new Command("enable")
      .description("Enable a plugin in the current project")
      .argument("<name>", "Name of the plugin")
      .action(async (name) => {
        await withSignal("plugin enable", async () => {
          await togglePlugin(name, true);
          console.log(
            `${GREEN}Enabled plugin '${name}' for this project.${RESET}`,
          );
        });
      }),
  )
  .addCommand(
    new Command("migrate")
      .description("Migrate legacy skills to the new plugin system")
      .option("--dry-run", "Show what would be migrated without copying")
      .action(async (options) => {
        await withSignal("plugin migrate", async () => {
          await migrateSkills(options);
        });
      }),
  )
  .addCommand(
    new Command("seed")
      .description("Seed atomic skills from the reasoning modes taxonomy")
      .option("--dry-run", "Show what would be seeded without copying")
      .action(async (options) => {
        await withSignal("plugin seed", async () => {
          await seedSkills(options);
        });
      }),
  )
  .addCommand(syncContextCommand);
