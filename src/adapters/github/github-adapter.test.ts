/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import {
  signedWebhookFixture,
  syntheticPullRequest,
  syntheticTerminalPages,
} from "../../../tests/helpers/synthetic-github.js";
import { createGitHubHarvestAdapter } from "./index.js";

describe("GitHub durable harvest adapter", () => {
  it("authenticates the original webhook bytes and fails closed", () => {
    const adapter = createGitHubHarvestAdapter();
    const { rawBody, signatureHeader, secret } = signedWebhookFixture();
    expect(
      adapter.verifyWebhookSignature(rawBody, signatureHeader, secret),
    ).toBe(true);
    expect(
      adapter.verifyWebhookSignature(
        Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8")))),
        signatureHeader,
        secret,
      ),
    ).toBe(false);
    for (const invalid of [
      undefined,
      "sha1=bad",
      "sha256=ab",
      `sha256=${"x".repeat(64)}`,
    ]) {
      expect(adapter.verifyWebhookSignature(rawBody, invalid, secret)).toBe(
        false,
      );
    }
    expect(adapter.verifyWebhookSignature(rawBody, signatureHeader, "")).toBe(
      false,
    );
  });

  it("collects later pages without conflating repository identity and branch names", async () => {
    const executeGh = vi.fn();
    for (const page of syntheticTerminalPages()) {
      executeGh.mockResolvedValueOnce(JSON.stringify(page));
    }
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

  it("keeps a terminal pull request when an updated item moves across pages", async () => {
    const earlier = "2026-11-18T12:00:00Z";
    const later = "2026-11-18T12:00:01Z";
    const requests = Array.from({ length: 102 }, (_, index) => ({
      ...syntheticPullRequest(index + 1, {
        merged_at: index === 101 ? later : earlier,
      }),
      updated_at: index === 101 ? later : earlier,
    }));
    const executeGh = vi.fn(async (args: readonly string[]) => {
      const path = new URL(args[args.length - 1], "https://api.github.com/");
      const page = Number(path.searchParams.get("page") ?? 1);
      const size = Number(path.searchParams.get("per_page") ?? 100);
      const start = (page - 1) * size;
      const results = requests.slice(start, start + size);
      if (executeGh.mock.calls.length === 1) {
        const [updated] = requests.splice(0, 1);
        requests.push({ ...updated, updated_at: "2026-11-18T12:00:02Z" });
      }
      return JSON.stringify(results);
    });
    const adapter = createGitHubHarvestAdapter({ executeGh });

    const facts = await adapter.listTerminalPullRequests({
      cwd: "/fixture/project",
      repoSlug: "example/project",
      baseBranch: "develop",
      sinceIso: earlier,
    });

    const numbers = facts.map(({ prNumber }) => prNumber);
    expect(numbers).toContain(102);
    expect(numbers).toContain(101);
    expect(new Set(numbers).size).toBe(102);
  });

  it("preserves closed-unmerged facts and unknown head repositories", async () => {
    const executeGh = vi.fn().mockResolvedValue(
      JSON.stringify(
        syntheticPullRequest(7, {
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
        syntheticPullRequest(8, {
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
    const executeGh = vi.fn().mockResolvedValue(
      JSON.stringify([
        syntheticPullRequest(1, {
          merged_at: "2026-11-18T11:59:59Z",
          closed_at: "2026-11-18T11:59:59Z",
        }),
        syntheticPullRequest(2),
        syntheticPullRequest(3, {
          merged_at: null,
          closed_at: "2026-11-18T12:00:01Z",
        }),
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
