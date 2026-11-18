/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import type { ProjectIdentityFacts } from "../../domain/project-id.js";
import type { VcsPort } from "../../ports/vcs-port.js";
import {
  createBranch,
  getCurrentBranch,
  isDirty,
  syncBranch,
} from "../../utils/git.js";
import { discoverGitIdentityFacts } from "./project-id.js";

export { discoverGitIdentityFacts, resolveProjectId } from "./project-id.js";

export function discoverIdentityFacts(cwd: string): ProjectIdentityFacts {
  return discoverGitIdentityFacts(cwd);
}

export function resolvePullRequestUrl(
  cwd: string,
  query: { prNumber?: number; headBranch?: string },
): string | null {
  if (query.prNumber) {
    try {
      const url = execFileSync(
        "gh",
        ["pr", "view", String(query.prNumber), "--json", "url", "-q", ".url"],
        {
          cwd,
          encoding: "utf-8",
          timeout: 10_000,
        },
      ).trim();
      if (url && url !== "null") return url;
    } catch {
      // PR might not exist
    }
  }
  if (query.headBranch) {
    try {
      const url = execFileSync(
        "gh",
        [
          "pr",
          "list",
          "--head",
          query.headBranch,
          "--json",
          "url",
          "-q",
          ".[0].url",
        ],
        { cwd, encoding: "utf-8", timeout: 10_000 },
      ).trim();
      if (url && url !== "null") return url;
    } catch {
      // No PR found
    }
  }
  return null;
}

export function mergePullRequest(cwd: string, prNumber: number): string {
  return execFileSync(
    "gh",
    ["pr", "merge", String(prNumber), "--merge", "--delete-branch"],
    {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
    },
  ).trim();
}

export function createGitVcsAdapter(): VcsPort {
  return {
    getCurrentBranch,
    isDirty,
    createBranch,
    syncBranch,
    discoverIdentityFacts,
    resolvePullRequestUrl,
    mergePullRequest,
  };
}
