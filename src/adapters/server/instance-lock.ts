/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import {
  constants,
  closeSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  InstanceLockBusyError,
  type InstanceLockHandle,
  type InstanceLockPort,
} from "../../ports/release-ops-port.js";

const LOCK_BUSY = 75;

function readHolderPid(fd: number): number | undefined {
  const buffer = Buffer.alloc(32);
  try {
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    const value = buffer.toString("utf8", 0, bytes).trim();
    const pid = Number(value);
    if (
      bytes < buffer.length &&
      /^[1-9]\d*$/.test(value) &&
      Number.isSafeInteger(pid)
    ) {
      return pid;
    }
  } catch {
    // The lock holder may release or rewrite the file during inspection.
  }
  return undefined;
}

export function instanceLockPath(runtimeDir: string): string {
  return join(runtimeDir, "server.lock");
}

export function ledgerLockPath(dbPath: string): string {
  return join(dirname(dbPath), `.${basename(dbPath)}.lock`);
}

export const acquireInstanceLock: InstanceLockPort["acquireInstanceLock"] = (
  runtimeDir,
  pid,
) => {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o750 });
  return acquireExclusiveLock(instanceLockPath(runtimeDir), pid);
};

export const acquireLedgerLock: InstanceLockPort["acquireLedgerLock"] = (
  dbPath,
  pid,
) => {
  const absolute = resolve(dbPath);
  const parent = dirname(absolute);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const database = join(realpathSync(parent), basename(absolute));
  const existing = lstatSync(database, { throwIfNoEntry: false });
  if (existing && (!existing.isFile() || existing.nlink !== 1)) {
    throw new Error(
      `Hosted ledger must be a regular file with a single link: ${database}`,
    );
  }
  return acquireExclusiveLock(ledgerLockPath(database), pid);
};

function acquireExclusiveLock(
  lockPath: string,
  pid: number,
): InstanceLockHandle {
  const fd = openSync(
    lockPath,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o640,
  );

  try {
    if (!fstatSync(fd).isFile())
      throw new Error(`Invalid lock file ${lockPath}`);
    // flock shares this open file description through descriptor 3. The
    // parent retains the lock after flock exits and releases it when fd closes.
    const result = spawnSync(
      "flock",
      ["-x", "-n", "-E", String(LOCK_BUSY), "3"],
      {
        stdio: ["ignore", "ignore", "pipe", fd],
        timeout: 2000,
        encoding: "utf8",
      },
    );
    if (result.status === LOCK_BUSY) {
      throw new InstanceLockBusyError(lockPath, readHolderPid(fd));
    }
    if (result.error || result.status !== 0) {
      throw new Error(
        `Could not acquire ${lockPath}: ${result.error?.message ?? result.stderr.trim()}`,
      );
    }
    ftruncateSync(fd, 0);
    writeFileSync(fd, `${pid}\n`);
  } catch (error) {
    closeSync(fd);
    throw error;
  }

  let released = false;
  return {
    pid,
    lockPath,
    release() {
      if (released) return;
      closeSync(fd);
      released = true;
    },
  };
}
