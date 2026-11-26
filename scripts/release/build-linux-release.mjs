/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, openSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function packRelease(
  sourceDir,
  outputFile,
  temporaryRoot = tmpdir(),
) {
  const staging = await mkdtemp(join(temporaryRoot, "gwrk-pack-"));
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
    // TypeScript emits the CLI without execute bits. Preserve a runnable package bin.
    await chmod(join(staging, "package/dist/cli.js"), 0o755);
    execFileSync("tar", ["-czf", outputFile, "-C", staging, "package"]);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function buildRelease(outputDir, releaseTag) {
  const root = resolve(
    process.env.GWRK_RELEASE_BUILDS_ROOT ??
      join(tmpdir(), "gwrk-release-builds"),
  );
  const cache = resolve(
    process.env.GWRK_RELEASE_CACHE ?? join(tmpdir(), "gwrk-release-pnpm-store"),
  );
  await mkdir(cache, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  execFileSync(
    "python3",
    [
      fileURLToPath(new URL("./build-preflight.py", import.meta.url)),
      "--runs-root",
      root,
      "--cache",
      cache,
      "--output",
      outputDir,
      "--workspace-bytes",
      process.env.GWRK_RELEASE_WORKSPACE_BYTES ?? String(4 * 1024 ** 3),
      "--cache-bytes",
      process.env.GWRK_RELEASE_CACHE_BYTES ?? String(2 * 1024 ** 3),
      "--output-bytes",
      process.env.GWRK_RELEASE_OUTPUT_BYTES ?? String(1024 ** 3),
      "--",
      process.execPath,
      fileURLToPath(import.meta.url),
      "--guarded-build",
      outputDir,
      ...(releaseTag ? [releaseTag] : []),
    ],
    { stdio: "inherit" },
  );
}

async function buildGuardedRelease(outputDir, releaseTag) {
  const workspace = process.env.GWRK_BUILD_WORKSPACE;
  const leaseFd = Number(process.env.GWRK_BUILD_LEASE_FD);
  const lockFd = Number(process.env.GWRK_BUILD_LOCK_FD);
  if (
    !workspace ||
    !Number.isInteger(leaseFd) ||
    !Number.isInteger(lockFd) ||
    leaseFd < 3 ||
    lockFd < 3 ||
    !fstatSync(leaseFd).isFile()
  )
    throw new Error(
      "Release build requires the preflight supervisor and inherited lease.",
    );
  execFileSync(
    "python3",
    [
      fileURLToPath(new URL("./build-preflight.py", import.meta.url)),
      "--assert-guard",
    ],
    {
      stdio: ["ignore", "inherit", "inherit", leaseFd, lockFd],
      env: {
        ...process.env,
        GWRK_BUILD_LEASE_FD: "3",
        GWRK_BUILD_LOCK_FD: "4",
      },
    },
  );
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
  const staging = await mkdtemp(join(workspace, "source-"));
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
      [
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--store-dir",
        process.env.GWRK_BUILD_CACHE,
      ],
      buildOptions,
    );
    execFileSync("pnpm", ["build"], buildOptions);

    const tarball = join(staging, "release.tgz");
    await packRelease(staging, tarball, workspace);

    const { validateReleaseManifest } = await import(
      pathToFileURL(join(staging, "dist/domain/release-packaging.js")).href
    );
    const { readReleaseInventory, sha256 } = await import(
      pathToFileURL(join(staging, "dist/adapters/release/inventory.js")).href
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
      ...(await readReleaseInventory(staging)),
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
  const guarded = process.argv[2] === "--guarded-build";
  const args = process.argv.slice(guarded ? 3 : 2);
  const [outputDir, releaseTag] = args;
  if (!outputDir || args.length > 2) {
    console.error(
      "Usage: node scripts/release/build-linux-release.mjs OUTPUT_DIR [RELEASE_TAG]",
    );
    process.exitCode = 1;
  } else {
    try {
      await (guarded ? buildGuardedRelease : buildRelease)(
        resolve(outputDir),
        releaseTag,
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
