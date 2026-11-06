/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnyManifest } from "../plugins/manifest.js";
import { loadManifest } from "../utils/manifest-loader.js";

const REGISTRY_URL =
  process.env.GWRK_REGISTRY_URL ||
  "https://github.com/gforge-esc/gwrk-plugins.git";
const getRegistryPath = () =>
  process.env.GWRK_REGISTRY_PATH ||
  path.join(os.homedir(), ".gwrk", "registry");
const getPluginsDir = () => path.join(os.homedir(), ".gwrk", "plugins");
const getPluginsLockPath = () =>
  path.join(os.homedir(), ".gwrk", "plugins-lock.json");

export interface RegistryVersionEntry {
  version: string;
  path: string;
  sha256: string;
  minGwrkVersion?: string;
}

export interface RegistryCatalogPlugin {
  name: string;
  type: AnyManifest["type"];
  tier?: string;
  latest: string;
  description: string;
  language?: string;
  framework?: string;
  disabled?: boolean;
  versions: Record<string, RegistryVersionEntry>;
}

export interface RegistryCatalog {
  schemaVersion: 1;
  generatedAt: string;
  plugins: Record<string, RegistryCatalogPlugin>;
}

export interface PluginsLockfile {
  schemaVersion: 1;
  plugins: Record<
    string,
    {
      name: string;
      type: string;
      version: string;
      sha256: string;
      source: string;
      installedAt: string;
    }
  >;
}

export interface PluginDoctorEntry {
  name: string;
  type: string;
  version: string;
  status: "ok" | "integrity-mismatch" | "invalid-manifest";
  expectedSha256?: string;
  actualSha256?: string;
  message?: string;
}

export interface PluginDoctorReport {
  healthy: boolean;
  entries: PluginDoctorEntry[];
}

/**
 * Parse a plugin specifier like "fastapi-standards@1.0.0" or "fastapi-standards@^1.0.0".
 * Ignores "@" inside URLs or file paths.
 */
export function parsePluginSpec(spec: string): {
  name: string;
  versionSpec?: string;
} {
  if (
    spec.startsWith("http://") ||
    spec.startsWith("https://") ||
    spec.startsWith("git@") ||
    spec.includes("/") ||
    spec.includes("\\")
  ) {
    return { name: spec };
  }
  const atIdx = spec.lastIndexOf("@");
  if (atIdx > 0) {
    return {
      name: spec.slice(0, atIdx),
      versionSpec: spec.slice(atIdx + 1) || undefined,
    };
  }
  return { name: spec };
}

function parseSemverParts(v: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
} | null {
  const clean = v.trim().replace(/^v/, "");
  const m = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: Number.parseInt(m[2], 10),
    patch: Number.parseInt(m[3], 10),
    prerelease: m[4],
  };
}

/**
 * Compare two SemVer strings: returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  return (pa.prerelease ?? "").localeCompare(pb.prerelease ?? "");
}

/**
 * Evaluate whether `version` satisfies `range` (exact, ^, ~, >=, *, latest).
 */
export function satisfiesSemver(version: string, range?: string): boolean {
  if (!range || range === "latest" || range === "*") return true;
  const r = range.trim();
  const pv = parseSemverParts(version);
  if (!pv) return version === r;

  if (r.startsWith("^")) {
    const pr = parseSemverParts(r.slice(1));
    if (!pr) return false;
    if (pv.major !== pr.major) return false;
    if (pr.major === 0 && pv.minor !== pr.minor) return false;
    return compareSemver(version, r.slice(1)) >= 0;
  }
  if (r.startsWith("~")) {
    const pr = parseSemverParts(r.slice(1));
    if (!pr) return false;
    if (pv.major !== pr.major || pv.minor !== pr.minor) return false;
    return compareSemver(version, r.slice(1)) >= 0;
  }
  if (r.startsWith(">=")) {
    return compareSemver(version, r.slice(2)) >= 0;
  }
  return compareSemver(version, r) === 0;
}

/**
 * Compute deterministic SHA-256 hex digest of a plugin directory's contents.
 * Excludes `.gwrk-source.json`, `.git`, `node_modules`, and `.DS_Store`.
 */
export async function computePluginDigest(pluginDir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === ".gwrk-source.json" ||
        entry.name === ".DS_Store"
      ) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(pluginDir, fullPath).replace(/\\/g, "/"));
      }
    }
  };
  await walk(pluginDir);
  files.sort();

  const hash = crypto.createHash("sha256");
  for (const relPath of files) {
    hash.update(`file:${relPath}\n`);
    const content = await fsp.readFile(path.join(pluginDir, relPath));
    hash.update(content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * Generate a `registry.json` catalog for a registry repository and write it to disk.
 */
export async function generateRegistryIndex(
  registryRoot = getRegistryPath(),
): Promise<RegistryCatalog> {
  const types = ["agents", "skills", "workflows", "extensions", "reviews"];
  const plugins: Record<string, RegistryCatalogPlugin> = {};

  for (const typeFolder of types) {
    const typePath = path.join(registryRoot, typeFolder);
    if (!fs.existsSync(typePath)) continue;
    const dirs = (await fsp.readdir(typePath)).sort();
    for (const dir of dirs) {
      const pluginPath = path.join(typePath, dir);
      const stat = await fsp.stat(pluginPath).catch(() => null);
      if (!stat?.isDirectory()) continue;
      const children = await fsp.readdir(pluginPath).catch(() => []);
      if (children.length === 0) continue;
      try {
        const manifest = await loadManifest(pluginPath);
        const sha256 = await computePluginDigest(pluginPath);
        const relPath = `${typeFolder}/${dir}`;
        const rawRecord = manifest as unknown as Record<string, unknown>;
        const versionEntry: RegistryVersionEntry = {
          version: manifest.version,
          path: relPath,
          sha256,
          ...(typeof rawRecord.minGwrkVersion === "string"
            ? { minGwrkVersion: rawRecord.minGwrkVersion }
            : {}),
        };
        plugins[manifest.name] = {
          name: manifest.name,
          type: manifest.type,
          ...(typeof rawRecord.tier === "string"
            ? { tier: rawRecord.tier }
            : {}),
          latest: manifest.version,
          description: manifest.description,
          ...(typeof rawRecord.language === "string"
            ? { language: rawRecord.language }
            : {}),
          ...(typeof rawRecord.framework === "string"
            ? { framework: rawRecord.framework }
            : {}),
          ...(typeof rawRecord.disabled === "boolean"
            ? { disabled: rawRecord.disabled }
            : {}),
          versions: {
            [manifest.version]: versionEntry,
          },
        };
      } catch {
        // Skip invalid plugin directories
      }
    }
  }

  const catalog: RegistryCatalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plugins,
  };

  await fsp.writeFile(
    path.join(registryRoot, "registry.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf-8",
  );
  return catalog;
}

async function readRegistryCatalog(
  registryRoot: string,
): Promise<RegistryCatalog | null> {
  const catalogPath = path.join(registryRoot, "registry.json");
  if (!fs.existsSync(catalogPath)) return null;
  try {
    const raw = await fsp.readFile(catalogPath, "utf-8");
    return JSON.parse(raw) as RegistryCatalog;
  } catch {
    return null;
  }
}

async function readPluginsLock(): Promise<PluginsLockfile> {
  const lockPath = getPluginsLockPath();
  if (!fs.existsSync(lockPath)) {
    return { schemaVersion: 1, plugins: {} };
  }
  try {
    const raw = await fsp.readFile(lockPath, "utf-8");
    return JSON.parse(raw) as PluginsLockfile;
  } catch {
    return { schemaVersion: 1, plugins: {} };
  }
}

async function writePluginsLock(lock: PluginsLockfile): Promise<void> {
  const lockPath = getPluginsLockPath();
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  await fsp.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf-8");
}

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
    } catch {
      // Offline or local test fixture
    }
  } else {
    try {
      execSync(`git clone ${REGISTRY_URL} ${registryDir}`, { stdio: "ignore" });
    } catch {
      // Offline or local test fixture
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
 * FR-042: Install a plugin by ID (with optional @version), URL, or local path.
 */
export async function installPlugin(
  idOrUrl: string,
  options: { force?: boolean } = {},
): Promise<AnyManifest> {
  const registryPath = getRegistryPath();
  const pluginsDir = getPluginsDir();
  const { name: requestedName, versionSpec } = parsePluginSpec(idOrUrl);
  let sourcePath = idOrUrl;
  let isTemp = false;
  let expectedSha256: string | undefined;

  // 1. Resolve source path
  if (idOrUrl.startsWith("http") || idOrUrl.includes("github.com")) {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "gwrk-plugin-"));
    execSync(`git clone ${idOrUrl} ${tempDir}`, { stdio: "ignore" });
    sourcePath = tempDir;
    isTemp = true;
  } else if (!fs.existsSync(idOrUrl)) {
    await syncRegistry();
    const catalog = await readRegistryCatalog(registryPath);
    let found = false;

    if (catalog?.plugins[requestedName]) {
      const catPlugin = catalog.plugins[requestedName];
      const availableVersions = Object.keys(catPlugin.versions).sort((a, b) =>
        compareSemver(b, a),
      );
      const matchingVersion = availableVersions.find((v) =>
        satisfiesSemver(v, versionSpec),
      );
      if (!matchingVersion) {
        throw new Error(
          `No version of '${requestedName}' satisfies version specifier '${versionSpec}' (available: ${availableVersions.join(", ")}).`,
        );
      }
      const verEntry = catPlugin.versions[matchingVersion];
      const candidatePath = path.join(registryPath, verEntry.path);
      if (fs.existsSync(candidatePath)) {
        sourcePath = candidatePath;
        expectedSha256 = verEntry.sha256;
        found = true;
      }
    }

    if (!found) {
      const types = ["agents", "skills", "workflows", "extensions", "reviews"];
      for (const type of types) {
        const regPath = path.join(registryPath, type, requestedName);
        if (fs.existsSync(regPath)) {
          sourcePath = regPath;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      throw new Error(
        `Plugin '${requestedName}' not found in registry or local path.`,
      );
    }
  }

  try {
    const manifest = await loadManifest(sourcePath);
    if (versionSpec && !satisfiesSemver(manifest.version, versionSpec)) {
      throw new Error(
        `Plugin '${manifest.name}' version ${manifest.version} does not satisfy requested version '${versionSpec}'.`,
      );
    }

    const actualSha256 = await computePluginDigest(sourcePath);
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA-256 integrity mismatch for plugin '${manifest.name}@${manifest.version}'. Expected ${expectedSha256}, got ${actualSha256}.`,
      );
    }

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
    const installedAt = new Date().toISOString();

    await fsp.writeFile(
      path.join(targetDir, ".gwrk-source.json"),
      JSON.stringify(
        {
          source: requestedName,
          type: sourceType,
          version: manifest.version,
          sha256: actualSha256,
          installedAt,
        },
        null,
        2,
      ),
      "utf-8",
    );

    const lock = await readPluginsLock();
    lock.plugins[manifest.name] = {
      name: manifest.name,
      type: manifest.type,
      version: manifest.version,
      sha256: actualSha256,
      source: requestedName,
      installedAt,
    };
    await writePluginsLock(lock);

    return manifest;
  } finally {
    if (isTemp) {
      await fsp.rm(sourcePath, { recursive: true, force: true });
    }
  }
}

/**
 * FR-043: Update installed plugins.
 * When `registry.json` is present, only updates if the registry's version is newer
 * than the installed version (or if `options.force` is true).
 */
export async function updatePlugin(
  name?: string,
  options: { force?: boolean } = {},
): Promise<string[]> {
  const updated: string[] = [];
  const pluginsDir = getPluginsDir();
  const registryPath = getRegistryPath();
  const catalog = await readRegistryCatalog(registryPath);
  const loader = new (await import("../plugins/loader.js")).PluginLoader();
  const types = ["agents", "skills", "workflows", "extensions", "reviews"];
  const toUpdate: { name: string; path: string }[] = [];

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
        const meta = JSON.parse(metaRaw) as {
          source?: string;
          version?: string;
        };
        if (meta.source) {
          const { name: sourceName } = parsePluginSpec(meta.source);
          if (catalog?.plugins[sourceName] && !options.force) {
            const remoteLatest = catalog.plugins[sourceName].latest;
            const installedVer =
              meta.version ??
              (await loadManifest(plugin.path).catch(() => null))?.version;
            if (
              installedVer &&
              compareSemver(remoteLatest, installedVer) <= 0
            ) {
              continue;
            }
          }
          await installPlugin(sourceName, { force: true });
          updated.push(plugin.name);
        }
      } catch {
        // Ignore if update fails
      }
    }
  }

  return updated;
}

/**
 * Verify integrity and manifest validity of all installed plugins.
 */
export async function doctorPlugins(): Promise<PluginDoctorReport> {
  const pluginsDir = getPluginsDir();
  const lock = await readPluginsLock();
  const types = ["agents", "skills", "workflows", "extensions", "reviews"];
  const entries: PluginDoctorEntry[] = [];

  for (const typeFolder of types) {
    const typePath = path.join(pluginsDir, typeFolder);
    if (!fs.existsSync(typePath)) continue;
    const dirs = (await fsp.readdir(typePath)).sort();
    for (const dir of dirs) {
      const pluginPath = path.join(typePath, dir);
      const stat = await fsp.stat(pluginPath).catch(() => null);
      if (!stat?.isDirectory()) continue;
      const children = await fsp.readdir(pluginPath).catch(() => []);
      if (children.length === 0) continue;

      try {
        const manifest = await loadManifest(pluginPath);
        const actualSha256 = await computePluginDigest(pluginPath);
        let expectedSha256: string | undefined =
          lock.plugins[manifest.name]?.sha256;
        if (!expectedSha256) {
          const sourceMetaPath = path.join(pluginPath, ".gwrk-source.json");
          if (fs.existsSync(sourceMetaPath)) {
            const meta = JSON.parse(
              await fsp.readFile(sourceMetaPath, "utf-8"),
            ) as { sha256?: string };
            expectedSha256 = meta.sha256;
          }
        }

        if (expectedSha256 && actualSha256 !== expectedSha256) {
          entries.push({
            name: manifest.name,
            type: manifest.type,
            version: manifest.version,
            status: "integrity-mismatch",
            expectedSha256,
            actualSha256,
            message: `Expected SHA-256 ${expectedSha256.slice(0, 12)}…, got ${actualSha256.slice(0, 12)}…`,
          });
        } else {
          entries.push({
            name: manifest.name,
            type: manifest.type,
            version: manifest.version,
            status: "ok",
            expectedSha256,
            actualSha256,
          });
        }
      } catch (err) {
        entries.push({
          name: dir,
          type: typeFolder.replace(/s$/, ""),
          version: "unknown",
          status: "invalid-manifest",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    healthy: entries.every((e) => e.status === "ok"),
    entries,
  };
}
