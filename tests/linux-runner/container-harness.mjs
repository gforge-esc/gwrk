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
  const changes = execFileSync(
    "git",
    ["diff", "--binary", "--no-ext-diff", "--no-color", "HEAD", "--"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (changes.length > 0) {
    execFileSync("git", ["-C", source, "apply", "--index"], { input: changes });
    const tree = execFileSync("git", ["-C", source, "write-tree"], {
      encoding: "utf8",
    }).trim();
    // The release builder packages HEAD via git archive.
    const candidate = execFileSync(
      "git",
      [
        "-C",
        source,
        "commit-tree",
        tree,
        "-p",
        "HEAD",
        "-m",
        "Container proof candidate",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Container proof",
          GIT_AUTHOR_EMAIL: "container-proof@example.invalid",
          GIT_COMMITTER_NAME: "Container proof",
          GIT_COMMITTER_EMAIL: "container-proof@example.invalid",
        },
      },
    ).trim();
    run("git", ["-C", source, "update-ref", "HEAD", candidate]);
  }
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
