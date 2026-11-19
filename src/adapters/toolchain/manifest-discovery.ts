/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import {
  type ToolchainManifestFacts,
  configuredBuildCommand,
  resolveBuildCommand,
} from "../../domain/toolchain.js";
import type { ProjectProfile } from "../../domain/types.js";

export function discoverToolchainManifests(
  cwd: string,
): ToolchainManifestFacts {
  const packageFile = path.join(cwd, "package.json");
  if (fs.existsSync(packageFile)) {
    let hasPackageBuildScript = false;
    try {
      const manifest = JSON.parse(fs.readFileSync(packageFile, "utf-8"));
      hasPackageBuildScript = Boolean(manifest?.scripts?.build);
    } catch {
      // An unreadable Node manifest still takes precedence over other toolchains.
    }
    return {
      hasPackageJson: true,
      hasPackageBuildScript,
      hasPnpmLock:
        hasPackageBuildScript &&
        fs.existsSync(path.join(cwd, "pnpm-lock.yaml")),
      hasYarnLock:
        hasPackageBuildScript && fs.existsSync(path.join(cwd, "yarn.lock")),
    };
  }
  return {
    hasCargoToml: fs.existsSync(path.join(cwd, "Cargo.toml")),
    hasGoMod: fs.existsSync(path.join(cwd, "go.mod")),
  };
}

export function getBuildCommand(
  profile: ProjectProfile,
  cwd: string,
): string | null {
  const configured = configuredBuildCommand(profile);
  return configured === undefined
    ? resolveBuildCommand(profile, discoverToolchainManifests(cwd))
    : configured;
}
