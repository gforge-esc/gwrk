/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Release-root retention adapter. Node standard library only: the installer
// runs it from the verified archive before `pnpm install`.

import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  statfs,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  type InventoryItem,
  type Protections,
  type RetentionAction,
  type SpaceSample,
  isReleaseName,
  parseReleasePointer,
  pathInside,
} from "../../domain/retention-policy.js";
import type {
  DiskSpacePort,
  RetentionEffectsPort,
  RetentionInventoryPort,
  RetentionReceiptPort,
  RunningServicePort,
} from "../../ports/retention-port.js";
import {
  assertRealDirectory,
  createQuarantine,
  writeReceipt,
} from "./retention-quarantine.js";

const SHA256 = /^[a-f0-9]{64}$/;

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** Sums regular file sizes without following symlinks. */
export async function treeBytes(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.isFile() ? info.size : 0;
  let total = 0;
  for (const entry of await readdir(path)) {
    total += await treeBytes(join(path, entry));
  }
  return total;
}

async function readRegularFile(path: string): Promise<Buffer | null> {
  try {
    const info = await lstat(path);
    return info.isFile() ? await readFile(path) : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Resolves symlinks in the longest existing prefix of an absolute path. */
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(await canonicalPath(parent), basename(absolute));
  }
}

export interface ReleaseRootOptions {
  /** Incoming version. Always protected. */
  readonly candidate?: string;
  /** The running gwrk service. Its release is protected and its configured paths block deletion. */
  readonly service: RunningServicePort;
  /** Called with bytes freed after each successful removal. */
  readonly onRemoved?: (bytes: number) => void;
}

export function createReleaseRootAdapter(
  root: string,
  options: ReleaseRootOptions,
): RetentionInventoryPort &
  RetentionEffectsPort &
  RetentionReceiptPort &
  DiskSpacePort {
  const releases = join(root, "releases");
  const control = join(root, ".retention");
  const quarantine = createQuarantine(control);

  /**
   * The release tree beneath the approved root must be real directories. A
   * symlinked `releases` or control path would redirect inventory, rename and
   * removal outside the root, so every entry point checks before effects.
   */
  async function assertTree(): Promise<void> {
    await assertRealDirectory(releases);
    await assertRealDirectory(control, true);
    for (const child of ["receipts", "trash", "intents"])
      await assertRealDirectory(join(control, child), true);
  }

  async function manifestHash(directory: string): Promise<string | null> {
    const bytes = await readRegularFile(
      join(directory, "release-manifest.json"),
    );
    return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
  }

  /** The configured path a release directory contains, if any. */
  async function holdsConfiguredPath(name: string): Promise<boolean> {
    const { configuredPaths } = await options.service.discover();
    const directory = join(await realpath(releases), name);
    for (const path of configuredPaths) {
      if (pathInside(await canonicalPath(path), directory)) return true;
    }
    return false;
  }

  async function identify(
    name: string,
  ): Promise<
    | { owned: true; identity: string; completedAt: string }
    | { owned: false; reason: string }
  > {
    const path = join(releases, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { owned: false, reason: "symlink" };
    if (!info.isDirectory()) return { owned: false, reason: "not a directory" };
    if (!isReleaseName(name))
      return { owned: false, reason: "not a release name" };
    const bytes = await readRegularFile(join(path, "release-manifest.json"));
    if (!bytes) return { owned: false, reason: "missing release manifest" };
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { owned: false, reason: "unreadable release manifest" };
    }
    if (manifest.version !== name)
      return { owned: false, reason: "manifest version mismatch" };
    if (
      typeof manifest.builtAt !== "string" ||
      Number.isNaN(Date.parse(manifest.builtAt))
    )
      return { owned: false, reason: "manifest has no build time" };
    if (
      typeof manifest.tarballSha256 !== "string" ||
      !SHA256.test(manifest.tarballSha256)
    )
      return { owned: false, reason: "manifest has no archive digest" };
    if (await holdsConfiguredPath(name))
      return { owned: false, reason: "holds a configured service path" };
    return {
      owned: true,
      identity: createHash("sha256").update(bytes).digest("hex"),
      completedAt: new Date(manifest.builtAt).toISOString(),
    };
  }

  async function resolvePointer(
    name: "current" | "previous",
  ): Promise<string | null> {
    const link = join(root, name);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(link);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!info.isSymbolicLink())
      throw new Error(`Release pointer ${link} must be a symlink.`);
    const parsed = parseReleasePointer(await readlink(link));
    if (!parsed.ok) throw new Error(`${parsed.reason} at ${link}.`);
    const target = join(releases, parsed.version);
    let targetInfo: Awaited<ReturnType<typeof lstat>>;
    try {
      targetInfo = await lstat(target);
    } catch (error) {
      if (isMissing(error))
        throw new Error(`Release pointer ${link} is dangling.`);
      throw error;
    }
    if (!targetInfo.isDirectory())
      throw new Error(
        `Release pointer ${link} must name a real release directory.`,
      );
    if (
      (await realpath(link)) !== join(await realpath(releases), parsed.version)
    )
      throw new Error(`Release pointer ${link} escapes ${releases}.`);
    return parsed.version;
  }

  return {
    async inventory() {
      await assertTree();
      const items: InventoryItem[] = [];
      for (const name of (await readdir(releases)).sort()) {
        if (name.startsWith(".")) continue; // Installer staging under the held lock.
        const path = join(releases, name);
        const id = await identify(name);
        const bytes = await treeBytes(path);
        items.push(
          id.owned
            ? {
                kind: "release",
                id: name,
                path,
                owned: true,
                identity: id.identity,
                completedAt: id.completedAt,
                bytes,
              }
            : {
                kind: "release",
                id: name,
                path,
                owned: false,
                unknownReason: id.reason,
                identity: "",
                bytes,
              },
        );
      }
      return items;
    },

    async reidentify(item) {
      await assertTree();
      try {
        const id = await identify(item.id);
        return id.owned ? id.identity : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async readProtections(): Promise<Protections> {
      await assertTree();
      const running = await options.service.discover();
      const protectedReleases = [
        await resolvePointer("current"),
        await resolvePointer("previous"),
        options.candidate ?? null,
        ...running.releases,
      ].filter((version): version is string => version !== null);
      return {
        releases: [...new Set(protectedReleases)].sort(),
        runs: [],
        images: [],
      };
    },

    async recoverQuarantine() {
      await assertTree();
      return quarantine.recover(async (intent, parked) => {
        const version = intent.key.slice("release:".length);
        if (
          !intent.key.startsWith("release:") ||
          !isReleaseName(version) ||
          intent.source !== join(releases, version) ||
          (await manifestHash(parked)) !== intent.identity
        )
          return false;
        // Restore first. Fresh inventory and protection checks decide whether
        // a prior deletion remains eligible under today's pointers/configuration.
        return "restore";
      });
    },

    async apply(action: RetentionAction) {
      if (action.action !== "delete-release" || !action.item.path)
        throw new Error(
          `Unsupported action ${action.action} for a release root.`,
        );
      await assertTree();
      const source = join(releases, action.item.id);
      const info = await lstat(source);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`${source} is no longer a release directory.`);
      const bytes = await treeBytes(source);
      const { token } = await quarantine.park({
        key: `release:${action.item.id}`,
        source,
        identity: action.item.identity,
      });
      await quarantine.discard(token);
      options.onRemoved?.(bytes);
    },

    async write(name, receipt) {
      return writeReceipt(control, name, receipt);
    },

    async sample(paths): Promise<SpaceSample[]> {
      return Promise.all(
        paths.map(async (path) => {
          const [space, info] = await Promise.all([statfs(path), stat(path)]);
          return {
            path,
            device: String(info.dev),
            availableBytes: space.bavail * space.bsize,
          };
        }),
      );
    },
  };
}
