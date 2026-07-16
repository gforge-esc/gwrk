/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjectId } from "./project-id.js";

describe("resolveProjectId (FR-036 / TR-035)", () => {
  it("should generate a consistent hash for the same non-git path", () => {
    const p = "/repo/gwrk";
    const id1 = resolveProjectId(p);
    const id2 = resolveProjectId(p);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("should generate different IDs for different non-git paths", () => {
    expect(resolveProjectId("/path/A")).not.toBe(resolveProjectId("/path/B"));
  });
});

describe("resolveProjectId — stable across worktrees (worktree-parallel ship)", () => {
  let tmp: string;
  const git = (args: string[], cwd: string) =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-projid-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves a linked worktree to the SAME id as its main checkout (shared remote)", () => {
    const main = path.join(tmp, "main");
    fs.mkdirSync(main);
    git(["init", "-q"], main);
    git(["config", "user.email", "t@t.co"], main);
    git(["config", "user.name", "t"], main);
    git(["remote", "add", "origin", "git@github.com:acme/widget.git"], main);
    fs.writeFileSync(path.join(main, "f"), "x");
    git(["add", "-A"], main);
    git(["commit", "-qm", "init"], main);

    const wt = path.join(tmp, "wt");
    git(["worktree", "add", "-q", wt, "-b", "feat/x"], main);

    // A worktree has a different cwd than the main checkout — the old
    // md5(cwd) scheme would give different ids and break harvest correlation.
    expect(resolveProjectId(wt)).toBe(resolveProjectId(main));
  });

  it("resolves different repos (different remotes) to different ids", () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    for (const [dir, url] of [
      [a, "git@github.com:acme/one.git"],
      [b, "git@github.com:acme/two.git"],
    ] as const) {
      fs.mkdirSync(dir);
      git(["init", "-q"], dir);
      git(["remote", "add", "origin", url], dir);
    }
    expect(resolveProjectId(a)).not.toBe(resolveProjectId(b));
  });

  it("normalizes ssh and https remotes of the same repo to the same id", () => {
    const ssh = path.join(tmp, "ssh");
    const https = path.join(tmp, "https");
    for (const [dir, url] of [
      [ssh, "git@github.com:acme/widget.git"],
      [https, "https://github.com/acme/widget.git"],
    ] as const) {
      fs.mkdirSync(dir);
      git(["init", "-q"], dir);
      git(["remote", "add", "origin", url], dir);
    }
    expect(resolveProjectId(ssh)).toBe(resolveProjectId(https));
  });
});
