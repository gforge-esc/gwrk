/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  GitHubHarvestPort,
  HarvestPullRequestFact,
} from "../../ports/operations-port.js";

const executeFile = promisify(execFile);
type ExecuteGh = (args: readonly string[], cwd: string) => Promise<string>;
const sha = z
  .string()
  .regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/)
  .nullable();
const timestamp = z.string().datetime({ offset: true }).nullable();
const pullRequest = z.object({
  number: z.number().int().positive().safe(),
  html_url: z.string().url(),
  state: z.enum(["open", "closed"]),
  merged_at: timestamp,
  closed_at: timestamp,
  merge_commit_sha: sha,
  base: z.object({
    ref: z.string().min(1),
    repo: z.object({ full_name: z.string().min(1) }),
  }),
  head: z.object({
    ref: z.string().min(1),
    sha,
    repo: z.object({ full_name: z.string().min(1) }).nullable(),
  }),
});

function repositoryPath(repoSlug: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoSlug))
    throw new Error("Invalid repository slug");
  return `repos/${repoSlug}`;
}

function fact(value: unknown, repoSlug: string): HarvestPullRequestFact {
  const pr = pullRequest.parse(value);
  if (pr.base.repo.full_name.toLowerCase() !== repoSlug.toLowerCase())
    throw new Error(
      "Pull request repository does not match the requested project",
    );
  const expectedUrl = `https://github.com/${repoSlug}/pull/${pr.number}`;
  if (pr.html_url.toLowerCase() !== expectedUrl.toLowerCase())
    throw new Error("Pull request URL does not match its repository identity");
  const merged = pr.merged_at !== null;
  if (merged && (pr.state !== "closed" || !pr.merge_commit_sha))
    throw new Error("Merged pull request is missing verified merge metadata");
  return {
    repoSlug,
    headRepoSlug: pr.head.repo?.full_name ?? null,
    prNumber: pr.number,
    prUrl: pr.html_url,
    state: merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
    merged,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    mergeCommitSha: pr.merge_commit_sha,
    mergedAt: pr.merged_at,
    closedAt: pr.closed_at,
  };
}

export function createGitHubHarvestAdapter(
  options: { executeGh?: ExecuteGh } = {},
): GitHubHarvestPort {
  const executeGh: ExecuteGh =
    options.executeGh ??
    (async (args, cwd) => {
      const { stdout } = await executeFile("gh", [...args], {
        cwd,
        timeout: 12_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      });
      return stdout;
    });
  const get = async (path: string, cwd: string): Promise<unknown> =>
    JSON.parse(
      await executeGh(
        [
          "api",
          "--method",
          "GET",
          "-H",
          "Accept: application/vnd.github+json",
          path,
        ],
        cwd,
      ),
    );
  return {
    verifyWebhookSignature(rawBody, signatureHeader, secret) {
      if (
        !secret ||
        !signatureHeader ||
        !/^sha256=[a-fA-F0-9]{64}$/.test(signatureHeader)
      )
        return false;
      const received = Buffer.from(signatureHeader.slice(7), "hex");
      const expected = createHmac("sha256", secret).update(rawBody).digest();
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    },
    async listTerminalPullRequests({ cwd, repoSlug, baseBranch, sinceIso }) {
      const repository = repositoryPath(repoSlug);
      const cutoff = sinceIso == null ? undefined : Date.parse(sinceIso);
      if (cutoff !== undefined && !Number.isFinite(cutoff))
        throw new Error("Invalid harvest cursor timestamp");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const collected = new Map<number, HarvestPullRequestFact>();
        const seenPrNumbers = new Set<number>();
        let concurrentUpdateDetected = false;
        for (let page = 1; page <= 1000; page += 1) {
          const query = new URLSearchParams({
            state: "closed",
            base: baseBranch,
            sort: "updated",
            direction: "asc",
            per_page: "100",
            page: String(page),
          });
          const response = await get(`${repository}/pulls?${query}`, cwd);
          if (!Array.isArray(response))
            throw new Error("Pull request page must be an array");
          for (const value of response) {
            const pr = fact(value, repoSlug);
            if (pr.state === "OPEN" || pr.baseBranch !== baseBranch)
              throw new Error(
                "Terminal pull request page contains mismatched scope",
              );
            if (seenPrNumbers.has(pr.prNumber)) {
              concurrentUpdateDetected = true;
              break;
            }
            seenPrNumbers.add(pr.prNumber);
            const terminalAt = pr.mergedAt ?? pr.closedAt;
            if (!terminalAt)
              throw new Error(
                "Terminal pull request is missing its completion timestamp",
              );
            if (cutoff === undefined || Date.parse(terminalAt) >= cutoff)
              collected.set(pr.prNumber, pr);
          }
          if (concurrentUpdateDetected) break;
          if (response.length < 100) return [...collected.values()];
        }
        if (concurrentUpdateDetected) continue;
        throw new Error(
          "Pull request pagination exceeded the bounded page limit",
        );
      }
      throw new Error(
        "Pull request scan could not establish completeness due to concurrent updates",
      );
    },
    async getPullRequest({ cwd, repoSlug, prNumber }) {
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0)
        throw new Error("Invalid pull request number");
      const result = fact(
        await get(`${repositoryPath(repoSlug)}/pulls/${prNumber}`, cwd),
        repoSlug,
      );
      if (result.prNumber !== prNumber)
        throw new Error("Pull request number does not match the lookup");
      return result;
    },
  };
}
