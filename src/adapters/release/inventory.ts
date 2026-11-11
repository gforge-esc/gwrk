/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import {
  type ReleaseManifest,
  validateReleaseManifest,
} from "../../domain/release-packaging.js";

export async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function readReleaseInventory(
  root: string,
): Promise<Pick<ReleaseManifest, "plugins" | "migrations" | "lockfileSha256">> {
  const pluginRoot = join(root, "dist/plugins/builtins");
  const plugins: ReleaseManifest["plugins"][number][] = [];
  const collections = await readdir(pluginRoot, { withFileTypes: true });
  for (const collection of collections
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const directory = join(pluginRoot, collection);
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

  const migrationsRoot = join(root, "dist/db/migrations");
  const migrations = await Promise.all(
    (await readdir(migrationsRoot)).sort().map(async (name) => ({
      name,
      sha256: await sha256(join(migrationsRoot, name)),
    })),
  );
  return {
    plugins,
    migrations,
    lockfileSha256: await sha256(join(root, "pnpm-lock.yaml")),
  };
}

export async function verifyInstalledRelease(
  root: string,
): Promise<ReleaseManifest> {
  const manifest = validateReleaseManifest(
    JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8")),
  );
  if (!manifest.ok) throw new Error(manifest.errors.join("\n"));
  const release = manifest.value;
  if (
    release.platform !== process.platform ||
    release.arch !== process.arch ||
    release.nodeAbi !== process.versions.modules
  ) {
    throw new Error(
      "Installed release does not match the runtime platform or Node.js ABI.",
    );
  }
  const { version } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  if (version !== release.version)
    throw new Error(
      "Installed package version does not match the release manifest.",
    );
  const inventory = await readReleaseInventory(root);
  if (
    inventory.lockfileSha256 !== release.lockfileSha256 ||
    !isDeepStrictEqual(inventory.plugins, release.plugins) ||
    !isDeepStrictEqual(inventory.migrations, release.migrations)
  ) {
    throw new Error(
      "Installed release inventory does not match the release manifest.",
    );
  }
  return release;
}
