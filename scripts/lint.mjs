/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const paths = readdirSync(root)
  .filter((entry) => entry !== ".git" && entry !== ".gwrkrc.local.json")
  .map((entry) => `./${entry}`);

const result = spawnSync(
  "biome",
  ["check", "--files-ignore-unknown=true", "--", ...paths],
  { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
);

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
