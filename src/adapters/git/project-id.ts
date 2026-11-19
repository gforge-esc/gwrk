/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  type ProjectIdentityFacts,
  computeProjectId,
  normalizeGitRemoteSlug,
} from "../../domain/project-id.js";
import type { EnrolledProject } from "../../domain/project-registry.js";
import { repositoryGitEnv } from "./process-env.js";

function readGit(projectRoot: string, args: string[]): string | null {
  try {
    return (
      execFileSync("git", args, {
        cwd: projectRoot,
        env: repositoryGitEnv(projectRoot),
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
    "--local",
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

export function normalizeRegistryRepo(repo: string | null): string | null {
  return repo
    ? (normalizeGitRemoteSlug(repo)?.replace(/^github\.com\//, "") ?? null)
    : null;
}

export function discoverVerifiedCheckout(root: string) {
  if (!isAbsolute(root)) return null;
  try {
    const topLevel = readGit(root, ["rev-parse", "--show-toplevel"]);
    if (!topLevel || realpathSync(topLevel) !== realpathSync(root)) return null;
    const facts = discoverGitIdentityFacts(root);
    return facts.gitCommonDir ? facts : null;
  } catch {
    return null;
  }
}

export function discoverVerifiedMirror(root: string) {
  if (!isAbsolute(root)) return null;
  try {
    if (readGit(root, ["rev-parse", "--is-bare-repository"]) !== "true")
      return null;
    const facts = discoverGitIdentityFacts(root);
    return facts.gitCommonDir &&
      realpathSync(facts.gitCommonDir) === realpathSync(root)
      ? facts
      : null;
  } catch {
    return null;
  }
}

export function verifyEnrolledCheckout(
  project: EnrolledProject,
  key: "localRoot" | "mirrorPath",
): string | undefined {
  const root = project[key];
  if (!root || !isAbsolute(root)) return undefined;
  try {
    const canonicalRoot = realpathSync(root);
    const facts =
      discoverVerifiedCheckout(canonicalRoot) ??
      (key === "mirrorPath" ? discoverVerifiedMirror(canonicalRoot) : null);
    if (
      facts &&
      computeProjectId(facts) === project.projectId &&
      normalizeRegistryRepo(facts.remoteOriginUrl ?? null) ===
        normalizeRegistryRepo(project.repoSlug)
    ) {
      return canonicalRoot;
    }
  } catch {
    return undefined;
  }
}
