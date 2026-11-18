/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGitHubHarvestAdapter } from "./index.js";

const pull = (number: number, changes: Record<string, unknown> = {}) => ({
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
  ...changes,
});

describe("GitHub durable harvest adapter", () => {
  it("authenticates the original webhook bytes and fails closed", () => {
    const adapter = createGitHubHarvestAdapter();
    const bytes = Buffer.from('{ "event": "merged" }');
    const signature = `sha256=${createHmac("sha256", "fixture-secret").update(bytes).digest("hex")}`;
    expect(
      adapter.verifyWebhookSignature(bytes, signature, "fixture-secret"),
    ).toBe(true);
    expect(
      adapter.verifyWebhookSignature(
        Buffer.from('{"event":"merged"}'),
        signature,
        "fixture-secret",
      ),
    ).toBe(false);
    for (const invalid of [
      undefined,
      "sha1=bad",
      "sha256=ab",
      `sha256=${"x".repeat(64)}`,
    ]) {
      expect(
        adapter.verifyWebhookSignature(bytes, invalid, "fixture-secret"),
      ).toBe(false);
    }
    expect(adapter.verifyWebhookSignature(bytes, signature, "")).toBe(false);
  });

  it("collects later pages without conflating repository identity and branch names", async () => {
    const executeGh = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify(Array.from({ length: 100 }, (_, i) => pull(i + 1))),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          pull(101, {
            head: {
              ref: "feature/repair",
              sha: "c".repeat(40),
              repo: { full_name: "fork/project" },
            },
          }),
        ]),
      );
    const adapter = createGitHubHarvestAdapter({ executeGh });
    const facts = await adapter.listTerminalPullRequests({
      cwd: "/fixture/project",
      repoSlug: "example/project",
      baseBranch: "develop",
    });
    expect(facts).toHaveLength(101);
    expect(facts[100]).toMatchObject({
      repoSlug: "example/project",
      headRepoSlug: "fork/project",
      prNumber: 101,
      state: "MERGED",
      mergeCommitSha: "b".repeat(40),
    });
    expect(executeGh).toHaveBeenCalledTimes(2);
    for (const [, cwd] of executeGh.mock.calls)
      expect(cwd).toBe("/fixture/project");
  });

  it("preserves closed-unmerged facts and unknown head repositories", async () => {
    const executeGh = vi.fn().mockResolvedValue(
      JSON.stringify(
        pull(7, {
          merged_at: null,
          merge_commit_sha: null,
          head: { ref: "repair", sha: null, repo: null },
        }),
      ),
    );
    const fact = await createGitHubHarvestAdapter({ executeGh }).getPullRequest(
      { cwd: "/fixture/project", repoSlug: "example/project", prNumber: 7 },
    );
    expect(fact).toMatchObject({
      merged: false,
      state: "CLOSED",
      headRepoSlug: null,
      headSha: null,
      mergeCommitSha: null,
    });
  });

  it("rejects foreign repository metadata before producing harvest facts", async () => {
    const executeGh = vi.fn().mockResolvedValue(
      JSON.stringify(
        pull(8, {
          base: { ref: "develop", repo: { full_name: "foreign/project" } },
        }),
      ),
    );
    await expect(
      createGitHubHarvestAdapter({ executeGh }).getPullRequest({
        cwd: "/fixture/project",
        repoSlug: "example/project",
        prNumber: 8,
      }),
    ).rejects.toThrow();
  });

  it("applies the cursor to terminal timestamps without dropping its boundary", async () => {
    const executeGh = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([
          pull(1, {
            merged_at: "2026-11-18T11:59:59Z",
            closed_at: "2026-11-18T11:59:59Z",
          }),
          pull(2),
          pull(3, { merged_at: null, closed_at: "2026-11-18T12:00:01Z" }),
        ]),
      );
    const facts = await createGitHubHarvestAdapter({
      executeGh,
    }).listTerminalPullRequests({
      cwd: "/fixture/project",
      repoSlug: "example/project",
      baseBranch: "develop",
      sinceIso: "2026-11-18T12:00:00Z",
    });
    expect(facts.map(({ prNumber }) => prNumber)).toEqual([2, 3]);
  });

  it("keeps lookup failure distinct from an absent pull request", async () => {
    const executeGh = vi
      .fn()
      .mockRejectedValue(new Error("credentials unavailable"));
    await expect(
      createGitHubHarvestAdapter({ executeGh }).getPullRequest({
        cwd: "/fixture/project",
        repoSlug: "example/project",
        prNumber: 8,
      }),
    ).rejects.toThrow("credentials unavailable");
  });
});
