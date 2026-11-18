/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectIdentityFacts } from "../domain/project-id.js";
import type { MergeTarget } from "../domain/project-registry.js";

export type PullRequestMergeOutcome = "merged" | "rejected" | "unavailable";

export interface PullRequestSummary {
  prNumber: number;
  prUrl: string | null;
}

export interface VcsPort {
  getCurrentBranch(cwd: string): Promise<string> | string;
  isDirty(cwd: string): Promise<boolean> | boolean;
  createBranch(branchName: string, cwd: string): Promise<void> | void;
  syncBranch(branchName: string, cwd: string): Promise<void> | void;
  discoverIdentityFacts(cwd: string): ProjectIdentityFacts;
  resolvePullRequestUrl(
    cwd: string,
    query: {
      prNumber?: number;
      headBranch?: string;
      expectedRepository?: string;
    },
  ): Promise<string | null> | string | null;
  inspectPullRequestMerge?(
    cwd: string,
    target: MergeTarget,
  ): PullRequestMergeOutcome | Promise<PullRequestMergeOutcome>;
  mergePullRequest(
    cwd: string,
    prNumber: number,
    expectedRepository?: string,
  ): Promise<string> | string;
}
