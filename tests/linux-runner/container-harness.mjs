/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const image =
  "node@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f";
const temporary = mkdtempSync(join(tmpdir(), "gwrk-runner-harness-"));
const source = join(temporary, "source");
const artifacts = join(temporary, "artifacts");
const fixtures = join(temporary, "fixtures");
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });

try {
  for (const directory of [source, artifacts, fixtures]) mkdirSync(directory);
  run("git", ["-C", source, "init", "--quiet"]);
  run("git", [
    "-C",
    source,
    "fetch",
    "--quiet",
    "--depth",
    "1",
    "--no-tags",
    process.cwd(),
    "HEAD",
  ]);
  run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  copyFileSync(
    "tests/linux-runner/container-proof.sh",
    join(fixtures, "proof.sh"),
  );

  run("docker", [
    "run",
    "--rm",
    "--mount",
    `type=bind,source=${source},target=/source,readonly`,
    "--mount",
    `type=bind,source=${artifacts},target=/artifacts`,
    "--workdir",
    "/source",
    image,
    "bash",
    "-euc",
    "git config --global --add safe.directory /source; npm install -g pnpm@9.15.9 --no-fund --no-audit; node scripts/release/build-linux-release.mjs /artifacts; cp deploy/linux-runner/install-release.sh /artifacts/",
  ]);
  run("docker", [
    "run",
    "--rm",
    "--mount",
    `type=bind,source=${artifacts},target=/artifacts,readonly`,
    "--mount",
    `type=bind,source=${fixtures},target=/fixtures,readonly`,
    image,
    "bash",
    "/fixtures/proof.sh",
  ]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
