/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A define run must never commit work it does not own.
 *
 * The previous implementation ran `git add -A` and committed, so every real
 * `gwrk define spec` / `define plan` absorbed the developer's entire uncommitted
 * working tree into a "…execution manifest" commit — with `--no-verify`, so no
 * hook could object. Observed twice while debugging: unrelated source edits
 * disappeared into commits nobody wrote.
 *
 * These run against a real temporary git repository rather than a mock, because
 * the whole defect was about which paths `git add` actually touches.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitPaths } from "./git.js";

describe("commitPaths", () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf-8" }).trim();

  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  };

  /**
   * Paths git still reports as dirty.
   *
   * Deliberately not via the trimming `git()` helper: porcelain v1 prefixes a
   * worktree-only change with a SPACE (" M file"), which a trim would eat and
   * shift every path by one. `--untracked-files=all` stops git collapsing an
   * untracked directory to "src/".
   */
  const dirty = () =>
    execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: repo, encoding: "utf-8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3));

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-commitpaths-"));
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    write("README.md", "seed\n");
    git("add", "-A");
    git("commit", "-q", "-m", "seed");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("commits the given path", () => {
    write("specs/012/.gwrk/runs/run.json", "{}\n");

    commitPaths(repo, "chore: manifest", ["specs/012/.gwrk/runs"]);

    expect(git("log", "-1", "--format=%s")).toBe("chore: manifest");
    expect(dirty()).not.toContain("specs/012/.gwrk/runs/run.json");
  });

  it("leaves unrelated dirty work alone — the whole point", () => {
    write("src/unrelated.ts", "// a developer's uncommitted edit\n");
    write("specs/012/.gwrk/runs/run.json", "{}\n");

    commitPaths(repo, "chore: manifest", ["specs/012/.gwrk/runs"]);

    expect(dirty()).toEqual(["src/unrelated.ts"]);
  });

  it("does not commit a modification to a tracked file it was not given", () => {
    write("README.md", "edited by the developer\n");
    write("specs/012/.gwrk/runs/run.json", "{}\n");

    commitPaths(repo, "chore: manifest", ["specs/012/.gwrk/runs"]);

    expect(git("show", "--stat", "--format=", "HEAD")).not.toContain("README.md");
    expect(dirty()).toEqual(["README.md"]);
  });

  it("makes no commit when the given paths have nothing to stage", () => {
    write("src/unrelated.ts", "still dirty\n");
    const before = git("rev-parse", "HEAD");

    commitPaths(repo, "chore: manifest", ["specs/012/.gwrk/runs"]);

    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(dirty()).toEqual(["src/unrelated.ts"]);
  });

  it("runs commit hooks rather than bypassing them", () => {
    // The old call passed --no-verify, so a hook could not object to a commit
    // it never asked for. A failing hook must now block the commit.
    const hookDir = path.join(repo, ".git", "hooks");
    fs.mkdirSync(hookDir, { recursive: true });
    const hook = path.join(hookDir, "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    fs.chmodSync(hook, 0o755);
    write("specs/012/.gwrk/runs/run.json", "{}\n");
    const before = git("rev-parse", "HEAD");

    commitPaths(repo, "chore: manifest", ["specs/012/.gwrk/runs"]);

    expect(git("rev-parse", "HEAD")).toBe(before);
  });

  it("does nothing when given no paths", () => {
    write("src/unrelated.ts", "dirty\n");
    const before = git("rev-parse", "HEAD");

    commitPaths(repo, "chore: manifest", []);

    expect(git("rev-parse", "HEAD")).toBe(before);
    expect(dirty()).toEqual(["src/unrelated.ts"]);
  });
});
