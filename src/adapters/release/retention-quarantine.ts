/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Owned quarantine for interrupted deletions. Node standard library only.
// Protocol: write an intent with the item's device and inode, rename the item
// into trash on the same filesystem, remove it, then remove the intent.
// Recovery removes only entries whose intent and identity both still match.
// Callers hold the root's exclusive lock for park, discard and recover.

import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { QuarantineRecovery } from "../../ports/retention-port.js";

export interface QuarantineIntent {
  readonly schema: 1;
  readonly token: string;
  readonly key: string;
  readonly source: string;
  readonly identity: string;
  readonly dev: string;
  readonly ino: string;
  readonly createdAt: string;
}

export interface QuarantineDeps {
  /** Test hook. Runs after the intent is durable and before the rename. */
  readonly beforeRename?: () => void;
  readonly now?: () => string;
}

const TOKEN = /^[a-z0-9]{1,16}-[a-f0-9]{16}$/;

const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

async function lstatOrNull(path: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Throws unless `path` is a real directory. Never follows a symlink, so an
 * ancestor that points outside the approved root fails closed. A missing
 * optional path passes.
 */
export async function assertRealDirectory(
  path: string,
  optional = false,
): Promise<void> {
  const info = await lstatOrNull(path);
  if (!info && optional) return;
  if (!info || info.isSymbolicLink() || !info.isDirectory())
    throw new Error(
      `${path} must be a real directory inside the approved root, not a symlink.`,
    );
}

/** Writes a receipt atomically under `<control>/receipts` without following symlinks. */
export async function writeReceipt(
  control: string,
  name: string,
  receipt: unknown,
): Promise<string> {
  const directory = join(control, "receipts");
  await assertRealDirectory(control, true);
  await mkdir(control, { recursive: true, mode: 0o700 });
  await assertRealDirectory(control);
  await assertRealDirectory(directory, true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertRealDirectory(directory);
  const path = join(directory, `${name}.json`);
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
  return path;
}

function parseIntent(text: string, token: string): QuarantineIntent | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const strings = ["key", "source", "identity", "dev", "ino", "createdAt"];
  if (
    value.schema !== 1 ||
    value.token !== token ||
    !strings.every((name) => typeof value[name] === "string")
  )
    return null;
  return value as unknown as QuarantineIntent;
}

export function createQuarantine(control: string, deps: QuarantineDeps = {}) {
  const trash = join(control, "trash");
  const intents = join(control, "intents");
  const intentPath = (token: string) => join(intents, `${token}.json`);

  async function realDirectory(path: string, create: boolean) {
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstatOrNull(path);
    if (!info) return false;
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(`Retention control path ${path} must be a directory.`);
    return true;
  }

  async function readIntent(token: string): Promise<QuarantineIntent | null> {
    const path = intentPath(token);
    const info = await lstatOrNull(path);
    if (!info?.isFile()) return null;
    return parseIntent(await readFile(path, "utf8"), token);
  }

  return {
    async park(input: {
      key: string;
      source: string;
      identity: string;
    }): Promise<{ token: string; parked: string }> {
      await realDirectory(control, true);
      await realDirectory(trash, true);
      await realDirectory(intents, true);
      const info = await lstat(input.source, { bigint: true });
      if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile()))
        throw new Error(`${input.source} is not a regular file or directory.`);
      const token = `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
      const intent: QuarantineIntent = {
        schema: 1,
        token,
        key: input.key,
        source: input.source,
        identity: input.identity,
        dev: String(info.dev),
        ino: String(info.ino),
        createdAt: (deps.now ?? (() => new Date().toISOString()))(),
      };
      const temporary = `${intentPath(token)}.tmp`;
      await writeFile(temporary, `${JSON.stringify(intent)}\n`, {
        mode: 0o600,
        flush: true,
      });
      await rename(temporary, intentPath(token));
      deps.beforeRename?.();
      const parked = join(trash, token);
      await rename(input.source, parked);
      return { token, parked };
    },

    async discard(token: string) {
      if (!TOKEN.test(token)) throw new Error("Invalid quarantine token.");
      await rm(join(trash, token), { recursive: true, force: true });
      await rm(intentPath(token), { force: true });
    },

    async recover(
      verify: (
        intent: QuarantineIntent,
        parked: string,
      ) => Promise<
        | boolean
        | "restore"
        | { action: "restore"; release: () => Promise<void> }
      >,
    ): Promise<QuarantineRecovery> {
      const recovered: string[] = [];
      const preserved: { name: string; reason: string }[] = [];
      if (!(await realDirectory(control, false)))
        return { recovered, preserved };
      const entries = (await realDirectory(trash, false))
        ? (await readdir(trash)).sort()
        : [];
      for (const name of entries) {
        const parked = join(trash, name);
        const intent = TOKEN.test(name) ? await readIntent(name) : null;
        if (!intent) {
          preserved.push({ name, reason: "no quarantine intent" });
          continue;
        }
        const info = await lstatOrNull(parked);
        if (!info || info.isSymbolicLink()) {
          preserved.push({ name, reason: "quarantined entry is a symlink" });
          continue;
        }
        if (
          String(info.dev) !== intent.dev ||
          String(info.ino) !== intent.ino
        ) {
          preserved.push({ name, reason: "quarantined identity changed" });
          continue;
        }
        const decision = await verify(intent, parked);
        if (!decision) {
          preserved.push({
            name,
            reason: "owner rejected quarantined identity",
          });
          continue;
        }
        const release =
          typeof decision === "object" ? decision.release : undefined;
        try {
          if (decision === "restore" || typeof decision === "object") {
            if (await lstatOrNull(intent.source)) {
              preserved.push({ name, reason: "original path already exists" });
              continue;
            }
            await rename(parked, intent.source);
          } else {
            await rm(parked, { recursive: true, force: true });
          }
          await rm(intentPath(name), { force: true });
          recovered.push(name);
        } finally {
          await release?.();
        }
      }
      // An intent with no trash entry either never moved its item or already
      // removed it. Neither leaves anything to delete.
      if (await realDirectory(intents, false)) {
        for (const file of await readdir(intents)) {
          const token = file.replace(/\.json$/, "");
          if (!file.endsWith(".json") || !TOKEN.test(token)) continue;
          if (entries.includes(token)) continue;
          const info = await lstatOrNull(intentPath(token));
          if (info?.isFile()) await rm(intentPath(token), { force: true });
        }
      }
      return { recovered, preserved };
    },
  };
}
