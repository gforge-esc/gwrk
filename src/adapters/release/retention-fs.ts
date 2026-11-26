/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Release-root retention adapter. Node standard library only: the installer
// runs it from the verified archive before `pnpm install`.

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  type InventoryItem,
  type Protections,
  type RetentionAction,
  type SpaceSample,
  isReleaseName,
  parseReleasePointer,
} from "../../domain/retention-policy.js";
import type {
  DiskSpacePort,
  RetentionEffectsPort,
  RetentionInventoryPort,
  RetentionReceiptPort,
} from "../../ports/retention-port.js";

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

export interface ReleaseRootOptions {
  /** Incoming version. Always protected. */
  readonly candidate?: string;
  /** Called with bytes freed after each successful removal. */
  readonly onRemoved?: (bytes: number) => void;
}

export function createReleaseRootAdapter(
  root: string,
  options: ReleaseRootOptions = {},
): RetentionInventoryPort &
  RetentionEffectsPort &
  RetentionReceiptPort &
  DiskSpacePort {
  const releases = join(root, "releases");
  const control = join(root, ".retention");
  const trash = join(control, "trash");

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
      try {
        const id = await identify(item.id);
        return id.owned ? id.identity : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async readProtections(): Promise<Protections> {
      const protectedReleases = [
        await resolvePointer("current"),
        await resolvePointer("previous"),
        options.candidate ?? null,
      ].filter((version): version is string => version !== null);
      return { releases: protectedReleases, runs: [], images: [] };
    },

    async sweepTrash() {
      try {
        const info = await lstat(trash);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error(`Retention trash ${trash} must be a directory.`);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const removed: string[] = [];
      for (const name of await readdir(trash)) {
        await rm(join(trash, name), { recursive: true, force: true });
        removed.push(name);
      }
      return removed;
    },

    async apply(action: RetentionAction) {
      if (action.action !== "delete-release" || !action.item.path)
        throw new Error(
          `Unsupported action ${action.action} for a release root.`,
        );
      const source = join(releases, action.item.id);
      const info = await lstat(source);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`${source} is no longer a release directory.`);
      const bytes = await treeBytes(source);
      await mkdir(trash, { recursive: true, mode: 0o700 });
      const parked = join(
        trash,
        `${action.item.id}-${process.pid}-${Date.now()}`,
      );
      await rename(source, parked);
      await rm(parked, { recursive: true, force: true });
      options.onRemoved?.(bytes);
    },

    async write(name, receipt) {
      const directory = join(control, "receipts");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, `${name}.json`);
      const temporary = `${path}.tmp-${process.pid}`;
      await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, path);
      return path;
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
