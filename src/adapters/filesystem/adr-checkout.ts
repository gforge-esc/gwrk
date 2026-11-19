/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { CommandError } from "../../utils/signal.js";

export async function resolveIndexDestination(
  filePath: string,
): Promise<string> {
  try {
    await fs.lstat(filePath);
  } catch (error) {
    const parent = dirname(filePath);
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      parent === filePath
    ) {
      throw error;
    }
    return join(await resolveIndexDestination(parent), basename(filePath));
  }
  return fs.realpath(filePath);
}

export async function resolveAdrPathInCheckout(
  checkout: string,
  filePath: string,
  resolvePath: (path: string) => Promise<string> = fs.realpath,
): Promise<string> {
  const resolved = await resolvePath(filePath).catch(() => undefined);
  if (resolved) {
    const suffix = relative(checkout, resolved);
    if (
      suffix !== ".." &&
      !suffix.startsWith(`..${sep}`) &&
      !isAbsolute(suffix)
    ) {
      return resolved;
    }
  }
  throw new CommandError(
    "Could not verify ADR paths inside the verified checkout.",
    1,
  );
}
