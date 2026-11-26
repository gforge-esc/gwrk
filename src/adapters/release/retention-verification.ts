/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Verification-run retention adapter. Deletes only heavy payloads that the
// run owner manifest lists. Receipts, signatures and the manifest stay.

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  InventoryItem,
  Protections,
  RetentionAction,
  SpaceSample,
} from "../../domain/retention-policy.js";
import type {
  DiskSpacePort,
  RetentionEffectsPort,
  RetentionInventoryPort,
  RetentionReceiptPort,
} from "../../ports/retention-port.js";
import { treeBytes } from "./retention-fs.js";

export const RUN_OWNER_FILE = "gwrk-run-owner.json";
const RUN_ID = /^[a-f0-9]{24}$/;
const TERMINAL = new Set(["completed", "failed"]);

interface HeavyPath {
  readonly root: "run" | "data";
  readonly path: string;
}

export interface VerificationRootDeps {
  /** True when another process holds the run lease. Backed by flock in production. */
  readonly leaseBusy: (leasePath: string) => Promise<boolean>;
  /** Runs the caller is about to stage. Always protected. */
  readonly protectedRuns: readonly string[];
}

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

function safeRelative(path: unknown): path is string {
  if (typeof path !== "string" || path === "" || path.startsWith("/"))
    return false;
  return path
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}

export function createVerificationRootAdapter(
  runsRoot: string,
  dataRoot: string,
  deps: VerificationRootDeps,
): RetentionInventoryPort &
  RetentionEffectsPort &
  RetentionReceiptPort &
  DiskSpacePort {
  const control = join(runsRoot, ".retention");
  const trash = join(control, "trash");

  const heavyLocation = (id: string, heavy: HeavyPath) =>
    join(
      heavy.root === "run" ? join(runsRoot, id) : join(dataRoot, id),
      heavy.path,
    );

  async function lstatOrNull(path: string) {
    try {
      return await lstat(path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** Every ancestor below the canonical root must be a real directory. */
  async function realChain(id: string, heavy: HeavyPath): Promise<boolean> {
    const base = heavy.root === "run" ? join(runsRoot, id) : join(dataRoot, id);
    const baseInfo = await lstatOrNull(base);
    if (baseInfo && (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()))
      return false;
    const parts = heavy.path.split("/");
    let current = base;
    for (const part of parts) {
      current = join(current, part);
      const info = await lstatOrNull(current);
      if (!info) return true;
      if (info.isSymbolicLink()) return false;
    }
    return true;
  }

  async function identify(id: string): Promise<
    | {
        owned: true;
        identity: string;
        completedAt?: string;
        heavy: HeavyPath[];
      }
    | { owned: false; reason: string }
  > {
    const run = join(runsRoot, id);
    const info = await lstat(run);
    if (info.isSymbolicLink()) return { owned: false, reason: "symlink" };
    if (!info.isDirectory()) return { owned: false, reason: "not a directory" };
    if (!RUN_ID.test(id)) return { owned: false, reason: "not a run ID" };
    const markerInfo = await lstatOrNull(join(run, RUN_OWNER_FILE));
    if (!markerInfo?.isFile())
      return { owned: false, reason: "no run owner manifest" };
    const bytes = await readFile(join(run, RUN_OWNER_FILE));
    let marker: Record<string, unknown>;
    try {
      marker = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { owned: false, reason: "unreadable run owner manifest" };
    }
    if (marker.schema !== 1 || marker.runId !== id)
      return { owned: false, reason: "run owner manifest mismatch" };
    const heavy = marker.heavy;
    if (
      !Array.isArray(heavy) ||
      !heavy.every(
        (entry) =>
          entry &&
          (entry.root === "run" || entry.root === "data") &&
          safeRelative(entry.path) &&
          entry.path !== RUN_OWNER_FILE,
      )
    )
      return { owned: false, reason: "unsafe heavy path" };
    for (const entry of heavy as HeavyPath[]) {
      if (!(await realChain(id, entry)))
        return { owned: false, reason: "heavy path crosses a symlink" };
    }
    const terminal =
      typeof marker.state === "string" &&
      TERMINAL.has(marker.state) &&
      typeof marker.completedAt === "string" &&
      !Number.isNaN(Date.parse(marker.completedAt));
    return {
      owned: true,
      identity: createHash("sha256").update(bytes).digest("hex"),
      completedAt: terminal
        ? new Date(marker.completedAt as string).toISOString()
        : undefined,
      heavy: heavy as HeavyPath[],
    };
  }

  async function heavyBytes(id: string, heavy: readonly HeavyPath[]) {
    let total = 0;
    for (const entry of heavy) {
      const path = heavyLocation(id, entry);
      if (await lstatOrNull(path)) total += await treeBytes(path);
    }
    return total;
  }

  return {
    async inventory() {
      const items: InventoryItem[] = [];
      for (const name of (await readdir(runsRoot)).sort()) {
        if (name.startsWith(".")) continue;
        const path = join(runsRoot, name);
        const id = await identify(name);
        if (!id.owned) {
          const info = await lstat(path);
          items.push({
            kind: "verification-run",
            id: name,
            path,
            owned: false,
            unknownReason: id.reason,
            identity: "",
            bytes: info.isDirectory() ? await treeBytes(path) : 0,
          });
          continue;
        }
        items.push({
          kind: "verification-run",
          id: name,
          path,
          owned: true,
          identity: id.identity,
          completedAt: id.completedAt,
          bytes: await treeBytes(path),
          heavyBytes: await heavyBytes(name, id.heavy),
        });
      }
      return items;
    },

    async reidentify(item) {
      const info = await lstatOrNull(join(runsRoot, item.id));
      if (!info) return null;
      const id = await identify(item.id);
      return id.owned ? id.identity : null;
    },

    async readProtections(): Promise<Protections> {
      const runs = new Set(deps.protectedRuns);
      for (const name of await readdir(runsRoot)) {
        if (name.startsWith(".")) continue;
        if (await deps.leaseBusy(join(runsRoot, name, ".lease")))
          runs.add(name);
      }
      return { releases: [], runs: [...runs].sort(), images: [] };
    },

    async sweepTrash() {
      const info = await lstatOrNull(trash);
      if (!info) return [];
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`Retention trash ${trash} must be a directory.`);
      const removed: string[] = [];
      for (const name of await readdir(trash)) {
        await rm(join(trash, name), { recursive: true, force: true });
        removed.push(name);
      }
      return removed;
    },

    async apply(action: RetentionAction) {
      if (action.action !== "prune-run-heavy")
        throw new Error(
          `Unsupported action ${action.action} for verification runs.`,
        );
      const id = await identify(action.item.id);
      if (!id.owned) throw new Error(`${action.item.id} is no longer owned.`);
      await mkdir(trash, { recursive: true, mode: 0o700 });
      for (const [index, entry] of id.heavy.entries()) {
        const path = heavyLocation(action.item.id, entry);
        if (!(await lstatOrNull(path))) continue;
        if (!(await realChain(action.item.id, entry)))
          throw new Error(`${path} crosses a symlink.`);
        const parked = join(trash, `${action.item.id}-${index}-${process.pid}`);
        if (entry.root === "run") {
          await rename(path, parked);
          await rm(parked, { recursive: true, force: true });
        } else {
          // The data root can be another filesystem. Remove in place without following links.
          await rm(path, { recursive: true, force: true });
        }
      }
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
