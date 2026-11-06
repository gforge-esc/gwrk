/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

class PluginDisabledError extends Error {
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

interface PluginLoaderOptions {
  globalDir?: string;
  projectDir?: string;
}

interface ListOptions {
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
    inherits?: boolean;
    entries?: string[];
    disable?: string[];
    override?: Record<string, string>;
    plugins?: Record<string, { enabled?: boolean }>;
    fromJson?: boolean;
  }> {
    if (!this.projectDir) return {};
    const yamlPath = path.join(this.projectDir, ".gwrk", "plugins.yaml");
    const jsonPath = path.join(this.projectDir, ".gwrk", "plugins.json");
    let yamlCfg: {
      disable?: string[];
      override?: Record<string, string>;
      plugins?: Record<string, { enabled?: boolean }>;
    } = {};
    try {
      const content = await fs.readFile(yamlPath, "utf-8");
      yamlCfg = parse(content) || {};
    } catch {
      // Optional
    }
    try {
      const jsonContent = await fs.readFile(jsonPath, "utf-8");
      const jsonCfg = JSON.parse(jsonContent) || {};
      return {
        inherits: jsonCfg.inherits,
        entries: Array.isArray(jsonCfg.entries) ? jsonCfg.entries : undefined,
        disable: [...(yamlCfg.disable || []), ...(jsonCfg.disable || [])],
        override: { ...(yamlCfg.override || {}), ...(jsonCfg.override || {}) },
        plugins: { ...(yamlCfg.plugins || {}), ...(jsonCfg.plugins || {}) },
        fromJson: true,
      };
    } catch {
      return yamlCfg;
    }
  }

  private async loadGlobalConfig(): Promise<{
    plugins?: Record<string, { enabled?: boolean }>;
  }> {
    const configPath = path.join(os.homedir(), ".gwrk", "config.json");
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return JSON.parse(content) || {};
    } catch {
      return {};
    }
  }

  private evaluateDisabledStatus(
    manifest: AnyManifest,
    typeFolder: string,
    localConfig: {
      disable?: string[];
      plugins?: Record<string, { enabled?: boolean }>;
      fromJson?: boolean;
    },
    globalConfig: {
      plugins?: Record<string, { enabled?: boolean }>;
    },
    isResolveContext = false,
  ): boolean {
    const fullName = `${typeFolder}/${manifest.name}`;
    const altFullName = `${manifest.type}s/${manifest.name}`;

    // 1. Explicit project-level plugins.<name>.enabled (AGY style)
    const projEntry =
      localConfig.plugins?.[manifest.name] ??
      localConfig.plugins?.[fullName] ??
      localConfig.plugins?.[altFullName];
    if (typeof projEntry?.enabled === "boolean") {
      return !projEntry.enabled;
    }

    // 2. Project disable list
    const disabledSet = new Set(localConfig.disable || []);
    if (
      disabledSet.has(fullName) ||
      disabledSet.has(manifest.name) ||
      disabledSet.has(altFullName)
    ) {
      if (
        isResolveContext &&
        !localConfig.fromJson &&
        (typeFolder === "skills" || typeFolder === "agents")
      ) {
        return false;
      }
      return true;
    }

    // 3. Global ~/.gwrk/config.json plugins.<name>.enabled
    const globalEntry =
      globalConfig.plugins?.[manifest.name] ??
      globalConfig.plugins?.[fullName] ??
      globalConfig.plugins?.[altFullName];
    if (typeof globalEntry?.enabled === "boolean") {
      return !globalEntry.enabled;
    }

    // 4. Manifest default (disabled: true in manifest.yaml)
    if (manifest.disabled === true) {
      return true;
    }

    return false;
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
    const globalConfig = await this.loadGlobalConfig();
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
    const visitedNames = new Set<string>();

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
              if (visitedNames.has(`${manifest.type}:${manifest.name}`)) continue;
              visitedNames.add(`${manifest.type}:${manifest.name}`);

              const isDisabled = this.evaluateDisabledStatus(
                manifest,
                typeFolder,
                config,
                globalConfig,
                false,
              );

              if (options.activeOnly && isDisabled) continue;
              if (!options.includeDisabled && isDisabled && !options.activeOnly)
                continue;

              // Filter by options
              if (options.type && manifest.type !== options.type) continue;
              const manifestRecord = manifest as unknown as Record<
                string,
                unknown
              >;
              if (
                options.tier &&
                typeof manifestRecord.tier === "string" &&
                manifestRecord.tier !== options.tier
              )
                continue;

              if (
                options.category &&
                typeof manifestRecord.category === "string" &&
                manifestRecord.category !== options.category
              )
                continue;

              plugins.push({
                name: manifest.name,
                type: manifest.type,
                tier:
                  typeof manifestRecord.tier === "string"
                    ? manifestRecord.tier
                    : undefined,
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

    // Scan project-local .gwrk/plugins/ directory (FR-L25-006)
    if (this.projectDir) {
      const projectPluginBase = path.join(this.projectDir, ".gwrk", "plugins");
      await scanDir(projectPluginBase);
    }

    // Scan .gwrk/plugins.json entries directories (AGY style)
    if (config.entries && config.entries.length > 0) {
      for (const entryDir of config.entries) {
        const resolvedEntry =
          this.projectDir && !path.isAbsolute(entryDir)
            ? path.resolve(this.projectDir, entryDir)
            : entryDir;
        await scanDir(resolvedEntry);
      }
    }

    // Scan user global dir (unless inherits === false in .gwrk/plugins.json)
    if (config.inherits !== false) {
      await scanDir(this.globalDir);
    }

    // Scan built-ins
    // @ts-ignore
    const builtInBase = path.join(import.meta.dirname, "builtins");
    await scanDir(builtInBase);

    return plugins;
  }

  async resolvePlugin(name: string): Promise<LoadedPlugin> {
    const config = await this.loadLocalConfig();
    const globalConfig = await this.loadGlobalConfig();

    // 1. Check local override
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

    const tryResolveFromBase = async (
      base: string,
      checkDisabled: boolean,
    ): Promise<LoadedPlugin | null> => {
      for (const type of types) {
        const pluginPath = path.join(base, type, name);
        if (visitedPaths.has(pluginPath)) continue;
        try {
          const manifest = await this.loadManifest(pluginPath);
          visitedPaths.add(pluginPath);
          if (
            checkDisabled &&
            this.evaluateDisabledStatus(
              manifest,
              type,
              config,
              globalConfig,
              true,
            )
          ) {
            throw new PluginDisabledError(name);
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
      return null;
    };

    // 2. Scan project-local .gwrk/plugins/ directory (FR-L25-006)
    if (this.projectDir) {
      const projectPluginBase = path.join(this.projectDir, ".gwrk", "plugins");
      const found = await tryResolveFromBase(projectPluginBase, true);
      if (found) return found;
    }

    // 3. Scan .gwrk/plugins.json entries directories
    if (config.entries && config.entries.length > 0) {
      for (const entryDir of config.entries) {
        const resolvedEntry =
          this.projectDir && !path.isAbsolute(entryDir)
            ? path.resolve(this.projectDir, entryDir)
            : entryDir;
        const found = await tryResolveFromBase(resolvedEntry, true);
        if (found) return found;
      }
    }

    // 4. Scan global directory (unless inherits === false)
    if (config.inherits !== false) {
      const found = await tryResolveFromBase(this.globalDir, true);
      if (found) return found;
    }

    // 5. Built-ins
    // @ts-ignore - import.meta.dirname exists in Node 20.11+
    const builtInBase = path.join(import.meta.dirname, "builtins");
    const foundBuiltIn = await tryResolveFromBase(builtInBase, true);
    if (foundBuiltIn) return foundBuiltIn;

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
