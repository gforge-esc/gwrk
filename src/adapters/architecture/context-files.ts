/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installContext } from "../../application/architecture/install-context.js";
import type { ContextInput } from "../../domain/architecture-context.js";
import type { ContextFilesPort } from "../../ports/context-files-port.js";

export function contextFiles(root: string): ContextFilesPort {
  function local(file: string) {
    const full = path.resolve(root, file);
    if (!full.startsWith(`${path.resolve(root)}${path.sep}`))
      throw new Error(`Path outside project: ${file}`);
    return full;
  }
  return {
    async read(file) {
      try {
        return await fs.readFile(local(file), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async write(file, content) {
      const full = local(file);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    },
    async list(directory) {
      try {
        return await fs.readdir(local(directory));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    bundled(file) {
      return fs.readFile(
        fileURLToPath(
          new URL(`../../plugins/builtins/${file}`, import.meta.url),
        ),
        "utf8",
      );
    },
    hash(content) {
      return crypto.createHash("sha256").update(content).digest("hex");
    },
    today() {
      return new Date().toLocaleDateString("en-CA");
    },
  };
}
export function installArchitectureContext(root: string, input: ContextInput) {
  return installContext(contextFiles(root), input);
}
