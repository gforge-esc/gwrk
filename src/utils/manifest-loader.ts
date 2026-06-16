/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { AnyManifestSchema, type AnyManifest } from "../plugins/manifest.js";

export class ManifestValidationError extends Error {
  constructor(name: string, details: string) {
    super(`Invalid manifest for plugin '${name}': ${details}`);
    this.name = "ManifestValidationError";
  }
}

/**
 * Loads and validates a manifest.yaml file from a plugin directory.
 */
export async function loadManifest(pluginDir: string): Promise<AnyManifest> {
  const manifestPath = path.join(pluginDir, "manifest.yaml");
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const raw = parse(content);
    const result = AnyManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new ManifestValidationError(
        path.basename(pluginDir),
        result.error.message,
      );
    }
    return result.data;
  } catch (e) {
    if (e instanceof ManifestValidationError) throw e;
    throw new Error(`Could not load manifest from ${manifestPath}: ${(e as Error).message}`);
  }
}
