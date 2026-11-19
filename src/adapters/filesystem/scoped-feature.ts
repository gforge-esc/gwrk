/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

function within(root: string, target: string): boolean {
  const suffix = relative(root, target);
  return (
    suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  );
}

export function scopedSpecsDirectory(projectRoot: string): string | undefined {
  try {
    const project = realpathSync(projectRoot);
    const specs = realpathSync(join(project, "specs"));
    return within(project, specs) &&
      specs !== project &&
      statSync(specs).isDirectory()
      ? specs
      : undefined;
  } catch {
    return undefined;
  }
}

export function scopedFeatureDirectory(
  projectRoot: string,
  featureId: string,
  options: { exactId?: boolean } = {},
): string | undefined {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(featureId)) return undefined;
  const specs = scopedSpecsDirectory(projectRoot);
  if (!specs) return undefined;
  try {
    const expected = join(specs, featureId);
    const feature = realpathSync(expected);
    return within(specs, feature) &&
      feature !== specs &&
      (options.exactId === false || feature === expected) &&
      statSync(feature).isDirectory()
      ? feature
      : undefined;
  } catch {
    return undefined;
  }
}

export function scopedFeaturePath(
  featureDir: string,
  ...parts: string[]
): string | undefined {
  try {
    const root = realpathSync(featureDir);
    const target = realpathSync(join(root, ...parts));
    return within(root, target) ? target : undefined;
  } catch {
    return undefined;
  }
}
