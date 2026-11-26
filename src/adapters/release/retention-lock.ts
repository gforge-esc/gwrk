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
