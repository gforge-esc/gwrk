/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { homedir } from "node:os";
import { join } from "node:path";
import { resolveGwrkPaths } from "../../domain/gwrk-paths.js";

export function gwrkHome(): string {
  return resolveGwrkPaths(process.env, homedir()).home;
}

export function gwrkRuntimeDir(): string {
  return resolveGwrkPaths(process.env, homedir()).runtimeDir;
}

export function gwrkPidPath(): string {
  return join(gwrkRuntimeDir(), "server.pid");
}

export function usesHostedRuntime(): boolean {
  return process.platform === "linux" && Boolean(process.env.GWRK_RUNTIME_DIR);
}
