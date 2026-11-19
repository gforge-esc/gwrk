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
    const pages = syntheticTerminalPages();
    const executeGh = vi.fn(async (args: readonly string[]) => {
      const url = new URL(args[args.length - 1], "https://api.github.com/");
      expect(url.searchParams.get("state")).toBe("all");
      expect(url.searchParams.get("sort")).toBe("created");
      expect(url.searchParams.has("base")).toBe(false);
      return JSON.stringify(pages[Number(url.searchParams.get("page")) - 1]);
    });
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
    expect(executeGh).toHaveBeenCalledTimes(4);
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

  it("does not skip a terminal pull request when an earlier closed pull request is reopened across pages", async () => {
    const earlier = "2026-11-18T12:00:00Z";
    const mid = "2026-11-18T12:00:01Z";
    const later = "2026-11-18T12:00:02Z";
    const requests = Array.from({ length: 102 }, (_, index) => {
      const prNumber = index + 1;
      if (prNumber === 1) {
        return {
          ...syntheticPullRequest(prNumber, {
            merged_at: null,
            merge_commit_sha: null,
            closed_at: earlier,
          }),
          updated_at: earlier,
        };
      }
      const timestamp =
        prNumber === 101 ? mid : prNumber === 102 ? later : earlier;
      return {
        ...syntheticPullRequest(prNumber, {
          merged_at: timestamp,
          closed_at: timestamp,
        }),
        updated_at: timestamp,
      };
    });
    const executeGh = vi.fn(async (args: readonly string[]) => {
      const path = new URL(args[args.length - 1], "https://api.github.com/");
      const page = Number(path.searchParams.get("page") ?? 1);
      const size = Number(path.searchParams.get("per_page") ?? 100);
      const start = (page - 1) * size;
      const results = requests.slice(start, start + size);
      if (executeGh.mock.calls.length === 1) {
        requests.splice(0, 1);
      }
      return JSON.stringify(results);
    });
    const adapter = createGitHubHarvestAdapter({ executeGh });

    const [result] = await Promise.allSettled([
      adapter.listTerminalPullRequests({
        cwd: "/fixture/project",
        repoSlug: "example/project",
        baseBranch: "develop",
        sinceIso: earlier,
      }),
    ]);

    if (result.status === "fulfilled") {
      const numbers = result.value.map(({ prNumber }) => prNumber);
      expect(numbers).toContain(101);
      expect(numbers).toContain(102);
    }
  });

  it("collects multi-page terminal pull requests when pull request numbers are not consecutive across pages", async () => {
    const earlier = "2026-11-18T12:00:00Z";
    const later = "2026-11-18T12:00:01Z";
    const requests = [
      ...Array.from({ length: 100 }, (_, index) => ({
        ...syntheticPullRequest(index + 1, {
          merged_at: earlier,
          closed_at: earlier,
        }),
        updated_at: earlier,
      })),
      {
        ...syntheticPullRequest(102, {
          merged_at: later,
          closed_at: later,
        }),
        updated_at: later,
      },
    ];
    const executeGh = vi.fn(async (args: readonly string[]) => {
      const path = new URL(args[args.length - 1], "https://api.github.com/");
      const page = Number(path.searchParams.get("page") ?? 1);
      const size = Number(path.searchParams.get("per_page") ?? 100);
      const direction = path.searchParams.get("direction") ?? "asc";
      const ordered = direction === "desc" ? [...requests].reverse() : requests;
      const start = (page - 1) * size;
      return JSON.stringify(ordered.slice(start, start + size));
    });
    const adapter = createGitHubHarvestAdapter({ executeGh });

    const facts = await adapter.listTerminalPullRequests({
      cwd: "/fixture/project",
      repoSlug: "example/project",
      baseBranch: "develop",
      sinceIso: earlier,
    });

    const numbers = facts.map(({ prNumber }) => prNumber);
    expect(numbers).toHaveLength(101);
    expect(numbers).toContain(100);
    expect(numbers).toContain(102);
  });

  it("does not skip a terminal pull request across pages when pull request numbers are not ascending", async () => {
    const earlier = "2026-11-18T12:00:00Z";
    const mid = "2026-11-18T12:00:01Z";
    const later = "2026-11-18T12:00:02Z";
    const requests = [
      {
        ...syntheticPullRequest(10, {
          merged_at: null,
          merge_commit_sha: null,
          closed_at: earlier,
        }),
        updated_at: earlier,
      },
      ...Array.from({ length: 99 }, (_, index) => ({
        ...syntheticPullRequest(index + 102, {
          merged_at: earlier,
          closed_at: earlier,
        }),
        updated_at: earlier,
      })),
      {
        ...syntheticPullRequest(50, {
          merged_at: mid,
          closed_at: mid,
        }),
        updated_at: mid,
      },
      {
        ...syntheticPullRequest(51, {
          merged_at: later,
          closed_at: later,
        }),
        updated_at: later,
      },
    ];
    const executeGh = vi.fn(async (args: readonly string[]) => {
      const path = new URL(args[args.length - 1], "https://api.github.com/");
      const page = Number(path.searchParams.get("page") ?? 1);
      const size = Number(path.searchParams.get("per_page") ?? 100);
      const direction = path.searchParams.get("direction") ?? "asc";
      const ordered = direction === "desc" ? [...requests].reverse() : requests;
      const start = (page - 1) * size;
      const results = ordered.slice(start, start + size);
      if (executeGh.mock.calls.length === 1) {
        requests.splice(0, 1);
      }
      return JSON.stringify(results);
    });
    const adapter = createGitHubHarvestAdapter({ executeGh });

    const [result] = await Promise.allSettled([
      adapter.listTerminalPullRequests({
        cwd: "/fixture/project",
        repoSlug: "example/project",
        baseBranch: "develop",
        sinceIso: earlier,
      }),
    ]);

    if (result.status === "fulfilled") {
      const numbers = result.value.map(({ prNumber }) => prNumber);
      expect(numbers).toContain(50);
      expect(numbers).toContain(51);
    }
  });

  it("filters eligible terminal facts after the repository-wide stable scan", async () => {
    const executeGh = vi.fn().mockResolvedValue(
      JSON.stringify([
        syntheticPullRequest(1, {
          state: "open",
          merged_at: null,
          merge_commit_sha: null,
          closed_at: null,
        }),
        syntheticPullRequest(3),
        syntheticPullRequest(7, {
          base: { ref: "main", repo: { full_name: "example/project" } },
        }),
      ]),
    );
    const facts = await createGitHubHarvestAdapter({
      executeGh,
    }).listTerminalPullRequests({
      cwd: "/fixture/project",
      repoSlug: "example/project",
      baseBranch: "develop",
    });
    expect(facts.map(({ prNumber }) => prNumber)).toEqual([3]);
  });

  it("refuses a continuously changing scan without returning a partial batch", async () => {
    let generation = 0;
    const executeGh = vi.fn(async () =>
      JSON.stringify([syntheticPullRequest(++generation)]),
    );
    await expect(
      createGitHubHarvestAdapter({ executeGh }).listTerminalPullRequests({
        cwd: "/fixture/project",
        repoSlug: "example/project",
        baseBranch: "develop",
      }),
    ).rejects.toThrow(/could not establish completeness/);
    expect(executeGh).toHaveBeenCalledTimes(10);
  });

  it("uses verified terminal state when a pull request is reopened without moving its identity", async () => {
    const executeGh = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([
          syntheticPullRequest(7, { merged_at: null, merge_commit_sha: null }),
        ]),
      )
      .mockResolvedValueOnce(
        JSON.stringify([
          syntheticPullRequest(7, {
            state: "open",
            merged_at: null,
            merge_commit_sha: null,
            closed_at: null,
          }),
        ]),
      );
    const facts = await createGitHubHarvestAdapter({
      executeGh,
    }).listTerminalPullRequests({
      cwd: "/fixture/project",
      repoSlug: "example/project",
      baseBranch: "develop",
    });
    expect(facts).toEqual([]);
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
