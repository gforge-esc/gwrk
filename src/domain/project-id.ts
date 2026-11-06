/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

export function resolveProjectId(projectRoot: string): string {
  return crypto.createHash("md5").update(projectKey(projectRoot)).digest("hex");
}

function projectKey(projectRoot: string): string {
  const remote = gitRemoteSlug(projectRoot);
  if (remote) return `remote:${remote}`;

  const mainWorktree = gitMainWorktree(projectRoot);
  if (mainWorktree) return `local:${mainWorktree}`;

  return `path:${projectRoot}`;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function gitRemoteSlug(projectRoot: string): string | null {
  const url = git(["config", "--get", "remote.origin.url"], projectRoot);
  if (!url) return null;

  const s = url.trim().replace(/\.git$/, "");
  const scp = s.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) return `${scp[1]}/${scp[2]}`.toLowerCase();
  const m = s.match(/^[a-z]+:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  return s.toLowerCase();
}

function gitMainWorktree(projectRoot: string): string | null {
  const commonDir = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    projectRoot,
  );
  if (!commonDir) return null;
  return path.dirname(commonDir);
}
