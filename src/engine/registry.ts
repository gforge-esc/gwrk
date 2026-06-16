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

const REGISTRY_URL = "https://github.com/gwrk-org/gwrk-plugins.git";
const getRegistryPath = () => path.join(os.homedir(), ".gwrk", "registry");
const getPluginsDir = () => path.join(os.homedir(), ".gwrk", "plugins");

/**
 * Registry Sync.
 * Clones or pulls the gwrk-plugins registry.
 */
export const syncRegistry = async (): Promise<void> => {
  const registryDir = getRegistryPath();
  const parentDir = path.dirname(registryDir);

  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (fs.existsSync(registryDir)) {
    try {
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

    // Copy files
    const entries = await fsp.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const src = path.join(sourcePath, entry.name);
      const dest = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(dest, { recursive: true });
        const subEntries = await fsp.readdir(src);
        for (const sub of subEntries) {
          await fsp.copyFile(path.join(src, sub), path.join(dest, sub));
        }
      } else {
        await fsp.copyFile(src, dest);
      }
    }

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
    if (fs.existsSync(path.join(plugin.path, ".git"))) {
      try {
        execSync("git pull", { cwd: plugin.path, stdio: "ignore" });
        updated.push(plugin.name);
      } catch {
        // Ignore if pull fails
      }
    }
  }

  return updated;
}
