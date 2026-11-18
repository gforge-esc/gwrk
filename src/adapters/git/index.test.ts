/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
import { mergePullRequest, resolvePullRequestUrl } from "./index.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-gh-arguments-"));
  writeFileSync(
    join(root, "gh"),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$GWRK_GH_ARGS_FIXTURE"\nprintf \'%s\\n\' "$GWRK_GH_REPLY_FIXTURE"\n',
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
      "-q",
      ".[0].url",
    ]);
  });
  it("returns null for an empty GitHub result", () => {
    vi.stubEnv("GWRK_GH_REPLY_FIXTURE", "null");
    expect(resolvePullRequestUrl(root, { headBranch: "feature" })).toBeNull();
  });
  it("passes merge selectors without shell evaluation", () => {
    expect(mergePullRequest(root, 42)).toContain("pull/42");
    expect(
      readFileSync(join(root, "arguments"), "utf8").trim().split("\n"),
    ).toEqual(["pr", "merge", "42", "--merge", "--delete-branch"]);
  });
});
