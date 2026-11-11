/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { ReleaseManifest } from "../../domain/release-packaging.js";

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
