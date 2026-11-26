/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Verification-run retention adapter. Deletes only heavy payloads that the
// run owner record lists. Receipts, signatures and the record stay.

import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import {
  type InventoryItem,
  type Protections,
  type RetentionAction,
  type RunClass,
  STAGED_TTL_MS,
  type SpaceSample,
  classifyRun,
} from "../../domain/retention-policy.js";
import type {
  DiskSpacePort,
  RetentionEffectsPort,
  RetentionInventoryPort,
  RetentionReceiptPort,
} from "../../ports/retention-port.js";
import { treeBytes } from "./retention-fs.js";
import { createQuarantine, writeReceipt } from "./retention-quarantine.js";

export const RUN_OWNER_FILE = "gwrk-run-owner.json";
export const RUN_LEASE_FILE = ".lease";
const RUN_ID = /^[a-f0-9]{24}$/;

/**
 * The removable payload class. Retention removes only these exact paths.
 * Proofs, receipts, manifests, checkpoints, signatures and the owner record
 * live outside them, so no owner record can declare durable evidence heavy.
 */
export const RUN_PAYLOADS = [
  "source.tar",
  "repo",
  "build-context",
  "original-rootfs.tar",
  "flattened-rootfs.tar",
  "input/preload-images.tar",
] as const;
export const DATA_PAYLOADS = ["images.tar", "docker"] as const;

/** `data-run` names the whole `<dataRoot>/<runId>` directory. */
type HeavyPath =
  | { readonly root: "run" | "data"; readonly path: string }
  | { readonly root: "data-run" };

export interface VerificationRootDeps {
  /** True when another process holds the run lease. Backed by flock in production. */
  readonly leaseBusy: (leasePath: string) => Promise<boolean>;
  /** Runs the caller is about to stage. Always protected. */
  readonly protectedRuns: readonly string[];
  readonly now: () => string;
  readonly stagedTtlMs?: number;
}

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

function validHeavy(entry: unknown): entry is HeavyPath {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  if (value.root === "data-run") return Object.keys(value).length === 1;
  if (Object.keys(value).length !== 2) return false;
  if (value.root === "run")
    return (RUN_PAYLOADS as readonly unknown[]).includes(value.path);
  if (value.root === "data")
    return (DATA_PAYLOADS as readonly unknown[]).includes(value.path);
  return false;
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
  const quarantine = createQuarantine(control);

  const heavyLocation = (id: string, heavy: HeavyPath) =>
    heavy.root === "data-run"
      ? join(dataRoot, id)
      : join(heavy.root === "run" ? join(runsRoot, id) : join(dataRoot, id), heavy.path);

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
    if (heavy.root === "data-run") return true;
    let current = base;
    for (const part of heavy.path.split("/")) {
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
        run: RunClass & { kind: Exclude<RunClass["kind"], "invalid"> };
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
      return { owned: false, reason: "no run owner record" };
    const bytes = await readFile(join(run, RUN_OWNER_FILE));
    let marker: Record<string, unknown>;
    try {
      marker = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { owned: false, reason: "unreadable run owner record" };
    }
    if (marker.schema !== 1 || marker.runId !== id)
      return { owned: false, reason: "run owner record mismatch" };
    const heavy = marker.heavy;
    if (!Array.isArray(heavy) || !heavy.every(validHeavy))
      return { owned: false, reason: "heavy path outside the removable payload class" };
    for (const entry of heavy) {
      if (!(await realChain(id, entry)))
        return { owned: false, reason: "heavy path crosses a symlink" };
    }
    const runClass = classifyRun({
      state: marker.state,
      startedAt: marker.startedAt,
      stagedAt: marker.stagedAt,
      completedAt: marker.completedAt,
      leaseBusy: await deps.leaseBusy(join(run, RUN_LEASE_FILE)),
      now: deps.now(),
      stagedTtlMs: deps.stagedTtlMs ?? STAGED_TTL_MS,
    });
    if (runClass.kind === "invalid")
      return { owned: false, reason: runClass.reason };
    return {
      owned: true,
      identity: createHash("sha256").update(bytes).digest("hex"),
      run: runClass,
      heavy,
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

  async function runNames(): Promise<string[]> {
    return (await readdir(runsRoot)).filter((name) => !name.startsWith(".")).sort();
  }

  return {
    async inventory() {
      const items: InventoryItem[] = [];
      for (const name of await runNames()) {
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
          completedAt: id.run.protected ? undefined : id.run.completedAt,
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
      return id.owned && !id.run.protected ? id.identity : null;
    },

    async readProtections(): Promise<Protections> {
      const runs = new Set(deps.protectedRuns);
      for (const name of await runNames()) {
        const id = await identify(name);
        if (id.owned && id.run.protected) runs.add(name);
      }
      return { releases: [], runs: [...runs].sort(), images: [] };
    },

    recoverQuarantine() {
      return quarantine.recover(async (intent) => intent.key.startsWith("run:"));
    },

    async apply(action: RetentionAction) {
      if (action.action !== "prune-run-heavy")
        throw new Error(
          `Unsupported action ${action.action} for verification runs.`,
        );
      const id = await identify(action.item.id);
      if (!id.owned) throw new Error(`${action.item.id} is no longer owned.`);
      for (const [index, entry] of id.heavy.entries()) {
        const path = heavyLocation(action.item.id, entry);
        const info = await lstatOrNull(path);
        if (!info) continue;
        if (info.isSymbolicLink() || !(await realChain(action.item.id, entry)))
          throw new Error(`${path} crosses a symlink.`);
        if (entry.root === "run") {
          const { token } = await quarantine.park({
            key: `run:${action.item.id}:${index}`,
            source: path,
            identity: id.identity,
          });
          await quarantine.discard(token);
        } else {
          // The data root can be another filesystem. Remove in place without following links.
          await rm(path, { recursive: true, force: true });
        }
      }
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
