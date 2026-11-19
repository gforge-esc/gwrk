/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";

let localEnvKeys: string[] | undefined;

export function repositoryGitEnv(projectRoot: string): NodeJS.ProcessEnv {
  localEnvKeys ??= execFileSync("git", ["rev-parse", "--local-env-vars"], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  })
    .trim()
    .split(/\r?\n/);

  const env = { ...process.env };
  for (const key of [...localEnvKeys, "GH_REPO"]) delete env[key];
  return env;
}
