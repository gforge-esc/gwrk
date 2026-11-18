/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  type ProjectIdentityFacts,
  normalizeGitRemoteSlug,
} from "../../domain/project-id.js";
import type { MergeTarget } from "../../domain/project-registry.js";
import {
  MergePreflightError,
  type PullRequestMergeOutcome,
  type VcsPort,
} from "../../ports/vcs-port.js";
import {
  createBranch,
  getCurrentBranch,
  isDirty,
  syncBranch,
} from "../../utils/git.js";
import { repositoryGitEnv } from "./process-env.js";
import { discoverGitIdentityFacts } from "./project-id.js";

export { discoverGitIdentityFacts, resolveProjectId } from "./project-id.js";

export function discoverIdentityFacts(cwd: string): ProjectIdentityFacts {
  return discoverGitIdentityFacts(cwd);
}

function runGh(
  cwd: string,
  args: string[],
  timeout: number,
  expectedRepository?: string,
): string {
  const { remoteOriginUrl, gitCommonDir } = discoverGitIdentityFacts(cwd);
  const repository = remoteOriginUrl
    ? normalizeGitRemoteSlug(remoteOriginUrl)
    : null;
  if (
    !gitCommonDir ||
    !repository ||
    !/^[a-z0-9.-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository)
  ) {
    throw new MergePreflightError(
      "Cannot verify the checkout's GitHub repository.",
    );
  }
  if (expectedRepository !== undefined && repository !== expectedRepository) {
    throw new MergePreflightError(
      "The checkout's GitHub repository differs from the merge target.",
    );
  }
  return execFileSync("gh", [...args, "--repo", repository], {
    cwd,
    encoding: "utf-8",
    env: { ...repositoryGitEnv(cwd), GH_PROMPT_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  }).trim();
}

function isPrNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0;
}

export function resolvePullRequestUrl(
  cwd: string,
  query: {
    prNumber?: number;
    headBranch?: string;
    expectedRepository?: string;
  },
): string | null {
  if (isPrNumber(query.prNumber)) {
    try {
      const pr = JSON.parse(
        runGh(
          cwd,
          ["pr", "view", String(query.prNumber), "--json", "url"],
          10_000,
          query.expectedRepository,
        ),
      );
      if (typeof pr?.url === "string" && pr.url) return pr.url;
    } catch {
      // A missing PR can still be resolved by branch.
    }
  }
  if (query.headBranch) {
    try {
      const prs = JSON.parse(
        runGh(
          cwd,
          ["pr", "list", "--head", query.headBranch, "--json", "url"],
          10_000,
          query.expectedRepository,
        ),
      );
      const url = Array.isArray(prs) ? prs[0]?.url : undefined;
      return typeof url === "string" && url ? url : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function inspectPullRequestMerge(
  cwd: string,
  target: MergeTarget,
): PullRequestMergeOutcome {
  if (!isPrNumber(target.prNumber)) return "unavailable";
  try {
    const pr = JSON.parse(
      runGh(
        cwd,
        ["pr", "view", String(target.prNumber), "--json", "number,state"],
        10_000,
        target.repository,
      ),
    );
    if (pr?.number !== target.prNumber) return "unavailable";
    if (pr.state === "MERGED") return "merged";
    if (pr.state === "CLOSED") return "rejected";
  } catch {
    return "unavailable";
  }
  return "unavailable";
}

export function mergePullRequest(
  cwd: string,
  prNumber: number,
  expectedRepository?: string,
): string {
  if (!isPrNumber(prNumber)) {
    throw new MergePreflightError(
      "Pull request number must be a positive integer.",
    );
  }
  return runGh(
    cwd,
    ["pr", "merge", String(prNumber), "--merge", "--delete-branch"],
    30_000,
    expectedRepository,
  );
}

export function createGitVcsAdapter(): VcsPort {
  return {
    getCurrentBranch,
    isDirty,
    createBranch,
    syncBranch,
    discoverIdentityFacts,
    resolvePullRequestUrl,
    inspectPullRequestMerge,
    mergePullRequest,
  };
}
