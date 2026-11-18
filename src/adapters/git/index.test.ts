/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectPullRequestMerge,
  mergePullRequest,
  resolvePullRequestUrl,
} from "./index.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-gh-arguments-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "https://github.com/org/alpha.git",
  ]);
  vi.stubEnv("GH_REPO", "org/beta");
  writeFileSync(
    join(root, "gh"),
    '#!/bin/sh\necho "$GH_PROMPT_DISABLED" > "$GWRK_GH_ARGS_FIXTURE.prompt"\nprintf \'%s\\n\' "$@" > "$GWRK_GH_ARGS_FIXTURE"\nprintf \'%s\\n\' "$GWRK_GH_REPLY_FIXTURE"\n',
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
  vi.stubEnv("GWRK_GH_ARGS_FIXTURE", join(root, "arguments"));
  vi.stubEnv("GWRK_GH_REPLY_FIXTURE", "https://example.invalid/pull/42");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("project GitHub commands", () => {
  it.each([{ prNumber: 42 }, { headBranch: "feature" }])(
    "does not query a drifted origin for enrolled scope %j",
    (query) => {
      execFileSync("git", [
        "-C",
        root,
        "remote",
        "set-url",
        "origin",
        "https://github.com/org/beta.git",
      ]);
      expect(
        resolvePullRequestUrl(root, {
          ...query,
          expectedRepository: "github.com/org/alpha",
        }),
      ).toBeNull();
      expect(existsSync(join(root, "arguments"))).toBe(false);
    },
  );
  it("passes branch names as one argument without shell evaluation", () => {
    const marker = join(root, "unexpected-shell-effect");
    const branch = `feature; touch '${marker}'; #`;
    resolvePullRequestUrl(root, { headBranch: branch });
    expect(existsSync(marker)).toBe(false);
    expect(
      readFileSync(join(root, "arguments"), "utf8").trim().split("\n"),
    ).toEqual([
      "pr",
      "list",
      "--head",
      branch,
      "--json",
      "url",
      "--repo",
      "github.com/org/alpha",
    ]);
  });
  it("pins number lookups to the verified checkout repository", () => {
    vi.stubEnv(
      "GWRK_GH_REPLY_FIXTURE",
      '{"url":"https://github.com/org/alpha/pull/42"}',
    );
    resolvePullRequestUrl(root, { prNumber: 42 });
    const args = readFileSync(join(root, "arguments"), "utf8")
      .trim()
      .split("\n");
    expect(args.slice(-2)).toEqual(["--repo", "github.com/org/alpha"]);
  });

  it("returns null for an empty GitHub result", () => {
    vi.stubEnv("GWRK_GH_REPLY_FIXTURE", "[]");
    expect(resolvePullRequestUrl(root, { headBranch: "feature" })).toBeNull();
  });
  it.each([
    [{ headBranch: "feature" }, '[{"url":"https://example.invalid/pull/42"}]'],
    [{ prNumber: 42 }, '{"url":"https://example.invalid/pull/42"}'],
  ])("reads the URL from GitHub JSON for %j", (query, reply) => {
    vi.stubEnv("GWRK_GH_REPLY_FIXTURE", reply);
    expect(resolvePullRequestUrl(root, query)).toBe(
      "https://example.invalid/pull/42",
    );
    expect(readFileSync(join(root, "arguments.prompt"), "utf8").trim()).toBe(
      "1",
    );
  });
  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid PR number %s",
    (prNumber) => {
      expect(resolvePullRequestUrl(root, { prNumber })).toBeNull();
      expect(() => mergePullRequest(root, prNumber)).toThrow(
        /positive integer/,
      );
      expect(existsSync(join(root, "arguments"))).toBe(false);
    },
  );
  it("passes merge selectors without shell evaluation", () => {
    expect(mergePullRequest(root, 42)).toContain("pull/42");
    expect(
      readFileSync(join(root, "arguments"), "utf8").trim().split("\n"),
    ).toEqual([
      "pr",
      "merge",
      "42",
      "--merge",
      "--delete-branch",
      "--repo",
      "github.com/org/alpha",
    ]);
  });

  const target = { repository: "github.com/org/alpha", prNumber: 42 };

  it.each([
    ['{"number":42,"state":"MERGED"}', "merged"],
    ['{"number":42,"state":"CLOSED"}', "rejected"],
    ['{"number":42,"state":"OPEN"}', "unavailable"],
    ['{"number":7,"state":"MERGED"}', "unavailable"],
    ['{"state":"MERGED"}', "unavailable"],
    ["malformed JSON", "unavailable"],
  ])("maps PR inspection response %s to %s", (reply, outcome) => {
    vi.stubEnv("GWRK_GH_REPLY_FIXTURE", reply);
    expect(inspectPullRequestMerge(root, target)).toBe(outcome);
    expect(
      readFileSync(join(root, "arguments"), "utf8").trim().split("\n"),
    ).toEqual([
      "pr",
      "view",
      "42",
      "--json",
      "number,state",
      "--repo",
      target.repository,
    ]);
  });

  it("reports unavailable when the inspection command fails", () => {
    writeFileSync(join(root, "gh"), "#!/bin/sh\nexit 1\n");
    expect(inspectPullRequestMerge(root, target)).toBe("unavailable");
  });

  it("blocks inspection and merge when the checkout's origin differs from the target", () => {
    execFileSync("git", [
      "-C",
      root,
      "remote",
      "set-url",
      "origin",
      "https://github.com/org/beta.git",
    ]);
    expect(inspectPullRequestMerge(root, target)).toBe("unavailable");
    expect(() =>
      mergePullRequest(root, target.prNumber, target.repository),
    ).toThrow();
    expect(existsSync(join(root, "arguments"))).toBe(false);
  });
});
