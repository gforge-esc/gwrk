/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function readPluginInventory(root, parse) {
  const plugins = [];
  for (const collection of (await readdir(root)).sort()) {
    const directory = join(root, collection);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const plugin of entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()) {
      const manifest = parse(
        await readFile(join(directory, plugin, "manifest.yaml"), "utf8"),
      );
      plugins.push({
        kind: manifest.type,
        name: manifest.name,
        version: manifest.version,
      });
    }
  }
  return plugins;
}

export async function packRelease(sourceDir, outputFile) {
  const staging = await mkdtemp(join(tmpdir(), "gwrk-pack-"));
  try {
    const [packed] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--json", "--ignore-scripts", "--pack-destination", staging],
        { cwd: sourceDir, encoding: "utf8" },
      ),
    );
    const files = new Set(packed.files.map(({ path }) => path));
    for (const required of ["dist/cli.js", "package.json"]) {
      if (!files.has(required))
        throw new Error(`Archive is missing ${required}.`);
    }

    // npm excludes pnpm-lock.yaml even when it appears in package.json#files.
    execFileSync("tar", ["-xf", join(staging, packed.filename), "-C", staging]);
    await copyFile(
      join(sourceDir, "pnpm-lock.yaml"),
      join(staging, "package/pnpm-lock.yaml"),
    );
    execFileSync("tar", ["-czf", outputFile, "-C", staging, "package"]);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function buildRelease(outputDir, releaseTag) {
  const nodeVersion = process.versions.node;
  if (process.platform !== "linux" || Number(nodeVersion.split(".")[0]) < 22) {
    throw new Error(
      "Build the Linux release on Linux with Node.js 22 or newer.",
    );
  }

  const commitSha = execFileSync(
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    {
      encoding: "utf8",
    },
  ).trim();
  const staging = await mkdtemp(join(tmpdir(), "gwrk-release-"));
  try {
    const sourceArchive = join(staging, "source.tar");
    const fd = openSync(sourceArchive, "wx");
    try {
      execFileSync("git", ["archive", commitSha], {
        stdio: ["ignore", fd, "inherit"],
      });
    } finally {
      closeSync(fd);
    }
    execFileSync("tar", ["-xf", sourceArchive, "-C", staging]);
    const { version } = JSON.parse(
      await readFile(join(staging, "package.json"), "utf8"),
    );
    if (
      releaseTag &&
      releaseTag !== `cli-v${version}` &&
      releaseTag !== `v${version}`
    ) {
      throw new Error(
        `Release tag ${releaseTag} does not match package version ${version}.`,
      );
    }

    const buildOptions = { cwd: staging, stdio: "inherit" };
    execFileSync(
      "pnpm",
      ["install", "--frozen-lockfile", "--ignore-scripts"],
      buildOptions,
    );
    execFileSync("pnpm", ["build"], buildOptions);

    const tarball = join(staging, "release.tgz");
    await packRelease(staging, tarball);

    const { parse } = await import(
      pathToFileURL(join(staging, "node_modules/yaml/dist/index.js")).href
    );
    const { validateReleaseManifest } = await import(
      pathToFileURL(join(staging, "dist/domain/release-packaging.js")).href
    );
    const migrationsRoot = join(staging, "dist/db/migrations");
    const migrations = await Promise.all(
      (await readdir(migrationsRoot)).sort().map(async (name) => ({
        name,
        sha256: await sha256(join(migrationsRoot, name)),
      })),
    );
    const tarballSha256 = await sha256(tarball);
    const manifest = validateReleaseManifest({
      version,
      commitSha,
      builtAt: new Date().toISOString(),
      nodeVersion,
      nodeAbi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      tarballSha256,
      lockfileSha256: await sha256(join(staging, "pnpm-lock.yaml")),
      plugins: await readPluginInventory(
        join(staging, "dist/plugins/builtins"),
        parse,
      ),
      migrations,
    });
    if (!manifest.ok) throw new Error(manifest.errors.join("\n"));

    const filename = `gwrk-${releaseTag ?? version}.tgz`;
    await copyFile(tarball, join(outputDir, filename));
    await writeFile(
      join(outputDir, `${filename}.sha256`),
      `${tarballSha256}  ${filename}\n`,
    );
    await writeFile(
      join(outputDir, "release-manifest.json"),
      `${JSON.stringify(manifest.value, null, 2)}\n`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [outputDir, releaseTag] = process.argv.slice(2);
  if (!outputDir || process.argv.length > 4) {
    console.error(
      "Usage: node scripts/release/build-linux-release.mjs OUTPUT_DIR [RELEASE_TAG]",
    );
    process.exitCode = 1;
  } else {
    try {
      await buildRelease(resolve(outputDir), releaseTag);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
