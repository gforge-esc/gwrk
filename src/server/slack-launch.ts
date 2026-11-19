/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";

export async function launchDetachedGwrk(
  args: string[],
  projectRoot: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const child = spawn("gwrk", args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env,
  });
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      child.removeListener("spawn", launched);
      reject(error);
    };
    const launched = () => {
      child.removeListener("error", failed);
      resolve();
    };
    child.once("error", failed);
    child.once("spawn", launched);
  });
  child.unref();
}
