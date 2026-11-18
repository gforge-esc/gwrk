/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const inventory = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, env: { ...gitEnv, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8" },
);
if (inventory.status !== 0) {
  console.error(inventory.error?.message ?? inventory.stderr);
  process.exit(1);
}
const paths = [...new Set(inventory.stdout.split("\0"))]
  .filter(
    (entry) =>
      entry && entry !== ".gwrkrc.local.json" && existsSync(join(root, entry)),
  )
  .map((entry) => `./${entry}`);

const result = spawnSync(
  "biome",
  ["check", "--files-ignore-unknown=true", "--", ...paths],
  { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
);

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
