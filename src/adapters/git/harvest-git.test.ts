/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHarvestAdapter } from "./harvest-git.js";
import { createGitVcsAdapter } from "./index.js";

let root: string;
let checkout: string;
let remote: string;
let initial: string;
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv))
  if (key.startsWith("GIT_")) delete cleanEnv[key];
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], {
    env: cleanEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-harvest-git-"));
  checkout = join(root, "developer");
  remote = join(root, "remote.git");
  git(root, "init", "--quiet", "--bare", remote);
  git(root, "init", "--quiet", "--initial-branch=develop", checkout);
  git(checkout, "config", "user.name", "Synthetic owner");
  git(checkout, "config", "user.email", "owner@example.invalid");
  writeFileSync(join(checkout, "file.txt"), "initial\n");
  git(checkout, "add", ".");
  git(checkout, "-c", "commit.gpgsign=false", "commit", "-qm", "Initial");
  initial = git(checkout, "rev-parse", "HEAD");
  git(checkout, "remote", "add", "origin", remote);
  git(
    checkout,
    "push",
    "--quiet",
    "origin",
    "develop",
    "HEAD:refs/heads/feature",
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe.each([
  ["standalone", createGitHarvestAdapter],
  ["production composition", createGitVcsAdapter],
] as const)("harvest Git adapter through %s", (_name, createAdapter) => {
  it("checks the verified commit in a detached worktree without changing developer work", async () => {
    const adapter = createAdapter();
    writeFileSync(join(checkout, "file.txt"), "developer edits\n");
    const before = git(checkout, "status", "--porcelain");
    const handle = await adapter.createDetachedCheckout(checkout, initial);
    try {
      expect(git(handle.checkoutDir, "rev-parse", "HEAD")).toBe(initial);
      expect(git(handle.checkoutDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
        "HEAD",
      );
      expect(readFileSync(join(handle.checkoutDir, "file.txt"), "utf8")).toBe(
        "initial\n",
      );
      expect(git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("develop");
      expect(git(checkout, "status", "--porcelain")).toBe(before);
    } finally {
      await adapter.removeDetachedCheckout(checkout, handle.checkoutDir);
    }
    expect(git(checkout, "worktree", "list", "--porcelain")).not.toContain(
      handle.checkoutDir,
    );
  });
  it("fetches trunk and checks ancestry with inherited repository selectors removed", async () => {
    const adapter = createAdapter();
    vi.stubEnv("GIT_DIR", remote);
    vi.stubEnv("GIT_WORK_TREE", root);
    await adapter.fetchBranch(checkout, "develop");
    expect(
      await adapter.resolveRefSha(checkout, "refs/remotes/origin/develop"),
    ).toBe(initial);
    expect(
      await adapter.isCommitAncestorOfRef(
        checkout,
        initial,
        "refs/remotes/origin/develop",
      ),
    ).toBe(true);
    expect(
      await adapter.resolveRefSha(checkout, "refs/heads/missing"),
    ).toBeNull();
    await expect(
      adapter.createDetachedCheckout(checkout, "HEAD"),
    ).rejects.toThrow();
    expect(git(remote, "config", "--get", "core.bare")).toBe("true");
  });
  it("blocks a moved tip and deletes only the expected remote branch tip", async () => {
    const adapter = createAdapter();
    writeFileSync(join(checkout, "file.txt"), "later\n");
    git(checkout, "add", ".");
    git(checkout, "-c", "commit.gpgsign=false", "commit", "-qm", "Later");
    const later = git(checkout, "rev-parse", "HEAD");
    git(checkout, "push", "--quiet", "origin", "HEAD:refs/heads/feature");
    expect(
      await adapter.deleteRemoteBranchAtTip(checkout, "feature", initial),
    ).toEqual({ deleted: false, reason: "tip_moved" });
    expect(await adapter.getRemoteBranchSha(checkout, "feature")).toBe(later);
    expect(
      await adapter.deleteRemoteBranchAtTip(checkout, "feature", later),
    ).toEqual({ deleted: true });
    expect(await adapter.getRemoteBranchSha(checkout, "feature")).toBeNull();
    expect(
      await adapter.deleteRemoteBranchAtTip(checkout, "feature", later),
    ).toEqual({ deleted: false, reason: "missing" });
    expect(await adapter.isCommitAncestorOfRef(checkout, later, initial)).toBe(
      false,
    );
  });
  it.each([
    ["a different push repository", "remote.origin.pushurl", ["other.git"]],
    [
      "multiple push URLs",
      "remote.origin.pushurl",
      ["remote.git", "other.git"],
    ],
    ["multiple fetch URLs", "remote.origin.url", ["other.git"]],
  ] as const)(
    "rejects %s and preserves both branch tips",
    async (_name, key, urls) => {
      const other = join(root, "other.git");
      git(root, "init", "--quiet", "--bare", other);
      git(checkout, "push", "--quiet", other, "HEAD:refs/heads/feature");
      for (const url of urls)
        git(checkout, "config", "--add", key, join(root, url));

      await expect(
        createAdapter().deleteRemoteBranchAtTip(checkout, "feature", initial),
      ).rejects.toThrow();
      expect(git(remote, "rev-parse", "refs/heads/feature")).toBe(initial);
      expect(git(other, "rev-parse", "refs/heads/feature")).toBe(initial);
    },
  );
  it.each(["remote.origin.pushurl", "remote.origin.url"])(
    "preserves the second repository when %s changes after verification",
    async (setting) => {
      const adapter = createAdapter();
      const other = join(root, "other.git");
      git(root, "init", "--quiet", "--bare", other);
      git(checkout, "push", "--quiet", other, "HEAD:refs/heads/feature");
      expect(await adapter.getRemoteBranchSha(checkout, "feature")).toBe(
        initial,
      );
      const realGit = execFileSync("which", ["git"], {
        encoding: "utf8",
        env: cleanEnv,
      }).trim();
      writeFileSync(
        join(root, "git"),
        [
          "#!/bin/sh",
          'if [ "$3" = "push" ]; then',
          '  GIT_DIR="$2/.git" "$GWRK_TEST_REAL_GIT" -C "$2" config --replace-all "$GWRK_TEST_REMOTE_SETTING" "$GWRK_TEST_OTHER_REMOTE" || exit "$?"',
          "fi",
          'exec "$GWRK_TEST_REAL_GIT" "$@"',
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
      vi.stubEnv("GWRK_TEST_REAL_GIT", realGit);
      vi.stubEnv("GWRK_TEST_OTHER_REMOTE", other);
      vi.stubEnv("GWRK_TEST_REMOTE_SETTING", setting);

      const [result] = await Promise.allSettled([
        adapter.deleteRemoteBranchAtTip(checkout, "feature", initial),
      ]);

      expect(git(checkout, "config", "--get", setting)).toBe(other);
      expect
        .soft(
          git(
            other,
            "for-each-ref",
            "--format=%(objectname)",
            "refs/heads/feature",
          ),
        )
        .toBe(initial);
      expect(
        git(
          remote,
          "for-each-ref",
          "--format=%(objectname)",
          "refs/heads/feature",
        ),
      ).toBe(
        result.status === "fulfilled" && result.value.deleted ? "" : initial,
      );
    },
  );
  it("keeps an explicit origin push URL bound to the verified repository", async () => {
    const other = join(root, "other.git");
    git(root, "init", "--quiet", "--bare", other);
    git(checkout, "push", "--quiet", other, "HEAD:refs/heads/feature");
    git(checkout, "config", "remote.origin.pushurl", remote);
    git(checkout, "config", `url.${other}.pushInsteadOf`, remote);
    expect(git(checkout, "remote", "get-url", "origin")).toBe(remote);
    expect(git(checkout, "remote", "get-url", "--push", "origin")).toBe(remote);

    const result = await createAdapter().deleteRemoteBranchAtTip(
      checkout,
      "feature",
      initial,
    );

    expect.soft(result).toEqual({ deleted: true });
    expect
      .soft(
        git(
          other,
          "for-each-ref",
          "--format=%(objectname)",
          "refs/heads/feature",
        ),
      )
      .toBe(initial);
    expect(
      git(
        remote,
        "for-each-ref",
        "--format=%(objectname)",
        "refs/heads/feature",
      ),
    ).toBe("");
  });
  it("preserves the second repository when a local origin alias changes before push", async () => {
    const other = join(root, "other.git");
    const origin = join(root, "origin.git");
    git(root, "init", "--quiet", "--bare", other);
    git(checkout, "push", "--quiet", other, "HEAD:refs/heads/feature");
    symlinkSync(remote, origin);
    git(checkout, "remote", "set-url", "origin", origin);

    const realGit = execFileSync("which", ["git"], {
      encoding: "utf8",
      env: cleanEnv,
    }).trim();
    writeFileSync(
      join(root, "git"),
      [
        "#!/bin/sh",
        'if [ "$3" = "push" ]; then',
        '  rm "$GWRK_TEST_ORIGIN" && ln -s "$GWRK_TEST_OTHER_REMOTE" "$GWRK_TEST_ORIGIN" || exit "$?"',
        "fi",
        'exec "$GWRK_TEST_REAL_GIT" "$@"',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
    vi.stubEnv("GWRK_TEST_REAL_GIT", realGit);
    vi.stubEnv("GWRK_TEST_ORIGIN", origin);
    vi.stubEnv("GWRK_TEST_OTHER_REMOTE", other);

    const [result] = await Promise.allSettled([
      createAdapter().deleteRemoteBranchAtTip(checkout, "feature", initial),
    ]);
    const tip = (repo: string) =>
      git(repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature");

    expect.soft(tip(other)).toBe(initial);
    expect(tip(remote)).toBe(
      result.status === "fulfilled" && result.value.deleted ? "" : initial,
    );
  });
  it("deletes a remote branch with a full SHA-256 lease", async () => {
    const local = join(root, "sha256-checkout");
    const target = join(root, "sha256-remote.git");
    git(root, "init", "--quiet", "--object-format=sha256", local);
    git(root, "init", "--quiet", "--bare", "--object-format=sha256", target);
    git(
      local,
      "-c",
      "user.name=Synthetic owner",
      "-c",
      "user.email=owner@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-qm",
      "Initial",
    );
    git(local, "remote", "add", "origin", target);
    git(local, "push", "--quiet", "origin", "HEAD:refs/heads/feature");
    const sha = git(local, "rev-parse", "HEAD");
    expect(sha).toHaveLength(64);
    expect(
      await createAdapter().deleteRemoteBranchAtTip(local, "feature", sha),
    ).toEqual({ deleted: true });
    expect(git(target, "for-each-ref", "refs/heads/feature")).toBe("");
  });
  it("preserves a branch that moves between remote inspection and delete", async () => {
    const adapter = createAdapter();
    writeFileSync(join(checkout, "file.txt"), "new trunk\n");
    git(checkout, "add", ".");
    git(checkout, "-c", "commit.gpgsign=false", "commit", "-qm", "New trunk");
    const later = git(checkout, "rev-parse", "HEAD");
    git(checkout, "push", "--quiet", "origin", "develop");
    const realGit = execFileSync("which", ["git"], {
      encoding: "utf8",
      env: cleanEnv,
    }).trim();
    const shim = join(root, "git");
    writeFileSync(
      shim,
      '#!/bin/sh\nif [ "$3" = "push" ]; then "$GWRK_TEST_REAL_GIT" --git-dir="$GWRK_TEST_REMOTE" update-ref refs/heads/feature "$GWRK_TEST_MOVED_SHA"; fi\nexec "$GWRK_TEST_REAL_GIT" "$@"\n',
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${root}:${process.env.PATH}`);
    vi.stubEnv("GWRK_TEST_REAL_GIT", realGit);
    vi.stubEnv("GWRK_TEST_REMOTE", remote);
    vi.stubEnv("GWRK_TEST_MOVED_SHA", later);
    expect(
      await adapter.deleteRemoteBranchAtTip(checkout, "feature", initial),
    ).toEqual({ deleted: false, reason: "tip_moved" });
    expect(git(remote, "rev-parse", "refs/heads/feature")).toBe(later);
  });

  it("rejects invalid branch selectors and checkout cleanup outside its ownership", async () => {
    const adapter = createAdapter();
    await expect(adapter.fetchBranch(checkout, "-bad")).rejects.toThrow();
    await expect(
      adapter.deleteRemoteBranchAtTip(checkout, "feature:develop", initial),
    ).rejects.toThrow();
    await expect(
      adapter.removeDetachedCheckout(checkout, checkout),
    ).rejects.toThrow();
    expect(git(checkout, "rev-parse", "HEAD")).toBe(initial);
  });
});
