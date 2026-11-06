/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadManifest } from "../utils/manifest-loader.js";
import type { AnyManifest } from "../plugins/manifest.js";

const REGISTRY_URL =
  process.env.GWRK_REGISTRY_URL ||
  "https://github.com/gforge-esc/gwrk-plugins.git";
const getRegistryPath = () =>
  process.env.GWRK_REGISTRY_PATH || path.join(os.homedir(), ".gwrk", "registry");
const getPluginsDir = () => path.join(os.homedir(), ".gwrk", "plugins");

/**
 * Registry Sync.
 * Clones or pulls the gwrk-plugins registry.
 */
export const syncRegistry = async (): Promise<void> => {
  if (process.env.GWRK_REGISTRY_PATH) {
    return;
  }
  const registryDir = getRegistryPath();
  const parentDir = path.dirname(registryDir);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (fs.existsSync(registryDir)) {
    try {
      const gitConfigPath = path.join(registryDir, ".git", "config");
      if (fs.existsSync(gitConfigPath)) {
        const gitConfig = fs.readFileSync(gitConfigPath, "utf-8");
        if (gitConfig.includes("gwrk-org/gwrk-plugins")) {
          execSync(`git remote set-url origin ${REGISTRY_URL}`, {
            cwd: registryDir,
            stdio: "ignore",
          });
        }
      }
      execSync("git pull", { cwd: registryDir, stdio: "ignore" });
    } catch (error) {
      // If pull fails, we might be offline or it's not a git repo, ignore for now
    }
  } else {
    try {
      execSync(`git clone ${REGISTRY_URL} ${registryDir}`, { stdio: "ignore" });
    } catch (error) {
      // If clone fails, ignore for now (maybe offline)
    }
  }
};

/**
 * FR-041: Search for plugins in the local registry.
 */
export async function searchPlugins(query: string): Promise<AnyManifest[]> {
  await syncRegistry();
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) return [];

  const results: AnyManifest[] = [];
  const types = ["agents", "skills", "workflows", "extensions", "reviews"];

  for (const type of types) {
    const typePath = path.join(registryPath, type);
    if (!fs.existsSync(typePath)) continue;

    const dirs = await fsp.readdir(typePath);
    for (const dir of dirs) {
      const pluginPath = path.join(typePath, dir);
      try {
        const manifest = await loadManifest(pluginPath);
        if (
          manifest.name.includes(query) ||
          manifest.description.toLowerCase().includes(query.toLowerCase())
        ) {
          results.push(manifest);
        }
      } catch {
        // Skip invalid
      }
    }
  }

  return results;
}

/**
 * FR-042: Install a plugin by ID, URL, or local path.
 */
export async function installPlugin(
  idOrUrl: string,
  options: { force?: boolean } = {},
): Promise<AnyManifest> {
  const registryPath = getRegistryPath();
  const pluginsDir = getPluginsDir();
  let sourcePath = idOrUrl;
  let isTemp = false;

  // 1. Resolve source path
  if (idOrUrl.startsWith("http") || idOrUrl.includes("github.com")) {
    // Clone to temp
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gwrk-plugin-"));
    execSync(`git clone ${idOrUrl} ${tempDir}`, { stdio: "ignore" });
    sourcePath = tempDir;
    isTemp = true;
  } else if (!fs.existsSync(idOrUrl)) {
    // Try registry
    await syncRegistry();
    const types = ["agents", "skills", "workflows", "extensions", "reviews"];
    let found = false;
    for (const type of types) {
      const regPath = path.join(registryPath, type, idOrUrl);
      if (fs.existsSync(regPath)) {
        sourcePath = regPath;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`Plugin '${idOrUrl}' not found in registry or local path.`);
    }
  }

  try {
    const manifest = await loadManifest(sourcePath);
    const targetTypeDir =
      manifest.type === "skill"
        ? "skills"
        : manifest.type === "agent"
          ? "agents"
          : manifest.type === "workflow"
            ? "workflows"
            : `${manifest.type}s`;

    const targetDir = path.join(pluginsDir, targetTypeDir, manifest.name);

    if (fs.existsSync(targetDir) && !options.force) {
      throw new Error(
        `Plugin '${manifest.name}' already installed. Use --force to overwrite.`,
      );
    }

    await fsp.mkdir(targetDir, { recursive: true });

    // Recursively copy plugin contents (skipping .git and node_modules)
    const entries = await fsp.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const src = path.join(sourcePath, entry.name);
      const dest = path.join(targetDir, entry.name);
      await fsp.cp(src, dest, { recursive: true, force: true });
    }

    const sourceType =
      idOrUrl.startsWith("http") || idOrUrl.includes("github.com")
        ? "git"
        : fs.existsSync(idOrUrl)
          ? "local"
          : "registry";
    await fsp.writeFile(
      path.join(targetDir, ".gwrk-source.json"),
      JSON.stringify(
        {
          source: idOrUrl,
          type: sourceType,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );

    return manifest;
  } finally {
    if (isTemp) {
      await fsp.rm(sourcePath, { recursive: true, force: true });
    }
  }
}

/**
 * FR-043: Update installed plugins.
 */
export async function updatePlugin(name?: string): Promise<string[]> {
  const updated: string[] = [];
  const pluginsDir = getPluginsDir();
  const loader = new (await import("../plugins/loader.js")).PluginLoader();
  const types = ["agents", "skills", "workflows", "extensions", "reviews"];
  const toUpdate: { name: string, path: string }[] = [];

  if (name) {
    const plugin = await loader.resolvePlugin(name);
    toUpdate.push({ name: plugin.manifest.name, path: plugin.path });
  } else {
    for (const typeFolder of types) {
      const typePath = path.join(pluginsDir, typeFolder);
      if (!fs.existsSync(typePath)) continue;
      const dirs = await fsp.readdir(typePath);
      for (const dir of dirs) {
        toUpdate.push({ name: dir, path: path.join(typePath, dir) });
      }
    }
  }

  for (const plugin of toUpdate) {
    const gitDir = path.join(plugin.path, ".git");
    const sourceMetaPath = path.join(plugin.path, ".gwrk-source.json");
    if (fs.existsSync(gitDir)) {
      try {
        execSync("git pull", { cwd: plugin.path, stdio: "ignore" });
        updated.push(plugin.name);
      } catch {
        // Ignore if pull fails
      }
    } else if (fs.existsSync(sourceMetaPath)) {
      try {
        const metaRaw = await fsp.readFile(sourceMetaPath, "utf-8");
        const meta = JSON.parse(metaRaw) as { source?: string };
        if (meta.source) {
          await installPlugin(meta.source, { force: true });
          updated.push(plugin.name);
        }
      } catch {
        // Ignore if update fails
      }
    }
  }

  return updated;
}
