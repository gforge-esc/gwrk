/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHmac } from "node:crypto";

export interface SyntheticGitHubPullRequest {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  closed_at: string | null;
  merge_commit_sha: string | null;
  base: { ref: string; repo: { full_name: string } };
  head: { ref: string; sha: string | null; repo: { full_name: string } | null };
}

export function signedWebhookFixture(): {
  rawBody: Buffer;
  signatureHeader: string;
  secret: string;
} {
  const secret = "fixture-secret";
  const pullRequest = syntheticPullRequest(1);
  const rawBody = Buffer.from(
    JSON.stringify(
      {
        action: "closed",
        number: pullRequest.number,
        repository: pullRequest.base.repo,
        pull_request: { ...pullRequest, merged: true },
      },
      null,
      2,
    ),
  );
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return { rawBody, signatureHeader: `sha256=${signature}`, secret };
}

export function syntheticPullRequest(
  number: number,
  overrides?: Partial<SyntheticGitHubPullRequest>,
): SyntheticGitHubPullRequest {
  return {
    number,
    html_url: `https://github.com/example/project/pull/${number}`,
    state: "closed",
    merged_at: "2026-11-18T12:00:00Z",
    closed_at: "2026-11-18T12:00:00Z",
    merge_commit_sha: "b".repeat(40),
    base: { ref: "develop", repo: { full_name: "example/project" } },
    head: {
      ref: "feature/repair",
      sha: "a".repeat(40),
      repo: { full_name: "example/project" },
    },
    ...overrides,
  };
}

export function syntheticTerminalPages(): SyntheticGitHubPullRequest[][] {
  return [
    Array.from({ length: 100 }, (_, i) => syntheticPullRequest(i + 1)),
    [
      syntheticPullRequest(101, {
        head: {
          ref: "feature/repair",
          sha: "c".repeat(40),
          repo: { full_name: "fork/project" },
        },
      }),
    ],
  ];
}
