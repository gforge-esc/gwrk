/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Proves that this process holds an exclusive flock on a root lock file.
// The shell or driver takes the lock and passes the descriptor. Linux shows
// the lock in /proc/self/fdinfo. Without procfs the proof fails closed.

import { fstat } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import type { LockProofPort } from "../../ports/retention-port.js";

export interface LockProbe {
  fstat(fd: number): Promise<{ dev: number; ino: number }>;
  stat(path: string): Promise<{ dev: number; ino: number }>;
  readFdinfo(fd: number): Promise<string>;
}

const LOCK_LINE =
  /^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\d+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/;

export function parseFdinfoLock(text: string, inode: number): boolean {
  return text
    .split("\n")
    .some((line) => LOCK_LINE.exec(line)?.[1] === String(inode));
}

export const nodeLockProbe: LockProbe = {
  fstat: (fd) =>
    new Promise((resolve, reject) =>
      fstat(fd, (error, info) =>
        error ? reject(error) : resolve({ dev: info.dev, ino: info.ino }),
      ),
    ),
  async stat(path) {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`${path} is not a regular file.`);
    return { dev: info.dev, ino: info.ino };
  },
  readFdinfo: (fd) => readFile(`/proc/self/fdinfo/${fd}`, "utf8"),
};

export function createFdLockProof(input: {
  fd: number;
  lockPath: string;
  probe?: LockProbe;
}): LockProofPort {
  const probe = input.probe ?? nodeLockProbe;
  return {
    async assertHeld() {
      const refuse = () =>
        new Error(
          `This process does not hold the exclusive lock ${input.lockPath} on descriptor ${input.fd}. Nothing was deleted.`,
        );
      try {
        const [held, file] = await Promise.all([
          probe.fstat(input.fd),
          probe.stat(input.lockPath),
        ]);
        if (held.dev !== file.dev || held.ino !== file.ino) throw refuse();
        if (!parseFdinfoLock(await probe.readFdinfo(input.fd), file.ino))
          throw refuse();
      } catch {
        throw refuse();
      }
    },
  };
}

/** A child holds flock until its stdin closes. Parent death releases it too. */
export async function acquireFlockLease(
  path: string,
): Promise<(() => Promise<void>) | null> {
  const { spawn } = await import("node:child_process");
  const { open } = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  const child = spawn(
    "sh",
    ["-c", "flock -n -E 75 3 || exit $?; printf 'held\\n'; cat >/dev/null"],
    { stdio: ["pipe", "pipe", "ignore", handle.fd] },
  );
  await handle.close();
  const input = child.stdin;
  const output = child.stdout;
  if (!input || !output) {
    child.kill();
    throw new Error("Run lease pipes unavailable.");
  }
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  const held = await new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      input.destroy();
      child.kill();
      reject(new Error("Run lease acquisition timed out."));
    }, 5000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Run lease could not be acquired."));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 75) resolve(false);
      else reject(new Error("Run lease holder exited before acquisition."));
    });
    output.once("data", (data) => {
      clearTimeout(timer);
      if (String(data) === "held\n") resolve(true);
      else {
        child.kill();
        reject(new Error("Invalid run lease handshake."));
      }
    });
  });
  if (!held) return null;
  return async () => {
    input.end();
    await exited;
  };
}
