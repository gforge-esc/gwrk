import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { type AnyManifest, AnyManifestSchema } from "./manifest.js";

export class PluginNotFoundError extends Error {
  constructor(name: string) {
    super(`Plugin '${name}' not found.`);
    this.name = "PluginNotFoundError";
  }
}

export class PluginDisabledError extends Error {
  constructor(name: string) {
    super(`Plugin '${name}' is disabled in this project.`);
    this.name = "PluginDisabledError";
  }
}

export class ManifestValidationError extends Error {
  constructor(name: string, details: string) {
    super(`Invalid manifest for plugin '${name}': ${details}`);
    this.name = "ManifestValidationError";
  }
}

export interface PluginLoaderOptions {
  globalDir?: string;
  projectDir?: string;
}

export interface ListOptions {
  activeOnly?: boolean;
  type?: string;
  tier?: string;
  category?: string;
  includeDisabled?: boolean;
}

export interface PluginSummary {
  name: string;
  type: string;
  tier?: string;
  version: string;
  description: string;
  status: "active" | "disabled";
}

export interface LoadedPlugin<T = AnyManifest> {
  manifest: T;
  path: string;
  status: "active" | "disabled";
}

export class PluginLoader {
  private globalDir: string;
  private projectDir: string | undefined;

  constructor(options: PluginLoaderOptions = {}) {
    this.globalDir =
      options.globalDir || path.join(os.homedir(), ".gwrk", "plugins");
    this.projectDir = options.projectDir;
  }

  private async loadLocalConfig(): Promise<{
    disable?: string[];
    override?: Record<string, string>;
  }> {
    if (!this.projectDir) return {};
    const configPath = path.join(this.projectDir, ".gwrk", "plugins.yaml");
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return parse(content) || {};
    } catch {
      return {};
    }
  }

  // T002-gate compatibility alias
  async getPlugin(name: string): Promise<LoadedPlugin> {
    return this.resolvePlugin(name);
  }

  // T002-gate compatibility alias
  async scanPlugins(): Promise<PluginSummary[]> {
    return this.listPlugins();
  }

  async listPlugins(options: ListOptions = {}): Promise<PluginSummary[]> {
    const config = await this.loadLocalConfig();
    const disabledSet = new Set(config.disable || []);
    const plugins: PluginSummary[] = [];

    const types = [
      "agents",
      "skills",
      "workflows",
      "extensions",
      "channels",
      "domains",
      "reviews",
    ];

    const visitedPaths = new Set<string>();

    const scanDir = async (base: string) => {
      for (const typeFolder of types) {
        const typePath = path.join(base, typeFolder);
        try {
          const dirs = await fs.readdir(typePath);
          for (const dir of dirs) {
            const pluginPath = path.join(typePath, dir);
            if (visitedPaths.has(pluginPath)) continue;
            try {
              const manifest = await this.loadManifest(pluginPath);
              visitedPaths.add(pluginPath);
              const fullName = `${typeFolder}/${manifest.name}`;
              const isDisabled =
                disabledSet.has(fullName) ||
                disabledSet.has(manifest.name) ||
                disabledSet.has(`${manifest.type}s/${manifest.name}`);

              if (options.activeOnly && isDisabled) continue;
              if (!options.includeDisabled && isDisabled && !options.activeOnly)
                continue;

              // Filter by options
              if (options.type && manifest.type !== options.type) continue;
              if (
                options.tier &&
                (manifest as any).tier &&
                (manifest as any).tier !== options.tier
              )
                continue;
              if (
                options.category &&
                (manifest as any).category &&
                (manifest as any).category !== options.category
              )
                continue;

              plugins.push({
                name: manifest.name,
                type: manifest.type,
                tier: (manifest as any).tier,
                version: manifest.version,
                description: manifest.description,
                status: isDisabled ? "disabled" : "active",
              });
            } catch (e) {
              // Skip invalid plugins
            }
          }
        } catch {
          // Skip missing type folders
        }
      }
    };

    // Scan user global dir first (to allow overrides)
    await scanDir(this.globalDir);

    // Scan built-ins
    // @ts-ignore
    const builtInBase = path.join(import.meta.dirname, "builtins");
    await scanDir(builtInBase);

    return plugins;
  }

  async resolvePlugin(name: string): Promise<LoadedPlugin> {
    const config = await this.loadLocalConfig();

    // 1. Check local disable
    const disabledSet = new Set(config.disable || []);
    // We check name as is, or prefixed with type if we can find it.
    // But since we don't know the type yet, we might need to check if it's in the disable list.
    // The test TC-009 says disable: [domains/writing].
    // If name is 'writing', should it be disabled?
    // Let's check all type folders for 'name' and see if any are disabled.

    // 2. Check local override
    if (config.override?.[name]) {
      const overridePath = config.override[name];
      const manifest = await this.loadManifest(overridePath);
      return {
        manifest,
        path: overridePath,
        status: "active",
      };
    }

    const types = [
      "agents",
      "skills",
      "workflows",
      "extensions",
      "channels",
      "domains",
      "reviews",
    ];
    const visitedPaths = new Set<string>();

    // 3. Scan project-local .gwrk/plugins/ directory (FR-L25-006)
    if (this.projectDir) {
      const projectPluginBase = path.join(this.projectDir, ".gwrk", "plugins");
      for (const type of types) {
        const pluginPath = path.join(projectPluginBase, type, name);
        try {
          const manifest = await this.loadManifest(pluginPath);
          visitedPaths.add(pluginPath);
          return {
            manifest,
            path: pluginPath,
            status: "active",
          };
        } catch {
          // Continue to next type
        }
      }
    }

    // 4. Scan global directory
    for (const type of types) {
      const pluginPath = path.join(this.globalDir, type, name);
      try {
        const manifest = await this.loadManifest(pluginPath);
        visitedPaths.add(pluginPath);
        const fullName = `${type}/${name}`;
        if (
          disabledSet.has(fullName) ||
          disabledSet.has(name) ||
          disabledSet.has(`${type}s/${name}`)
        ) {
          // Check if it's a global-only type that cannot be disabled
          if (type === "skills" || type === "agents") {
            // Ignore disable for these types (FR-005)
          } else {
            throw new PluginDisabledError(name);
          }
        }
        return {
          manifest,
          path: pluginPath,
          status: "active",
        };
      } catch (e) {
        if (e instanceof PluginDisabledError) throw e;
        // Continue to next type
      }
    }

    // 5. Built-ins
    // @ts-ignore - import.meta.dirname exists in Node 20.11+
    const builtInBase = path.join(import.meta.dirname, "builtins");
    for (const type of types) {
      const pluginPath = path.join(builtInBase, type, name);
      if (visitedPaths.has(pluginPath)) continue;
      try {
        const manifest = await this.loadManifest(pluginPath);
        return {
          manifest,
          path: pluginPath,
          status: "active",
        };
      } catch (e) {
        // Continue
      }
    }

    // 6. Not found
    throw new PluginNotFoundError(name);
  }

  private async loadManifest(pluginDir: string): Promise<AnyManifest> {
    const manifestPath = path.join(pluginDir, "manifest.yaml");
    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      const raw = parse(content);
      const result = AnyManifestSchema.safeParse(raw);
      if (!result.success) {
        throw new ManifestValidationError(
          path.basename(pluginDir),
          result.error.message,
        );
      }
      return result.data;
    } catch (e) {
      if (
        e instanceof ManifestValidationError ||
        e instanceof PluginDisabledError
      )
        throw e;
      throw new Error(`Could not load manifest from ${manifestPath}`);
    }
  }
}
