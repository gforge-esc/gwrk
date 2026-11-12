/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  type ProjectIdentityFacts,
  computeProjectId,
} from "../../domain/project-id.js";

function readGit(projectRoot: string, args: string[]): string | null {
  try {
    return (
      execFileSync("git", args, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
        timeout: 5_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export function discoverGitIdentityFacts(
  projectRoot: string,
): ProjectIdentityFacts {
  const remoteOriginUrl = readGit(projectRoot, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  const gitCommonDir = readGit(projectRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return { projectRoot, remoteOriginUrl, gitCommonDir };
}

export function resolveGitCheckoutRoot(directory: string): string {
  return readGit(directory, ["rev-parse", "--show-toplevel"]) ?? directory;
}

export function resolveProjectId(projectRoot: string): string {
  return computeProjectId(discoverGitIdentityFacts(projectRoot));
}
