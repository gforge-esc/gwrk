/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import {
  constants,
  closeSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { InstanceLockPort } from "../../ports/release-ops-port.js";

const LOCK_BUSY = 75;

export const acquireInstanceLock: InstanceLockPort["acquireInstanceLock"] = (
  runtimeDir,
  pid,
) => {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o750 });
  const lockPath = join(runtimeDir, "server.lock");
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
      throw new Error(`A gwrk server already holds ${lockPath}`);
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
};
