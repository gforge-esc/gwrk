/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { VcsHarvestExtensions } from "../../ports/vcs-port.js";
import { repositoryGitEnv } from "./process-env.js";

const execute = promisify(execFile);
const isSha = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const failureStatus = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;

export function createGitHarvestAdapter(): VcsHarvestExtensions {
  const checkouts = new Map<string, { repository: string; parent: string }>();
  const gitOutput = async (cwd: string, args: string[]) => {
    const result = await execute("git", ["-C", cwd, ...args], {
      env: repositoryGitEnv(cwd),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  };
  const git = async (cwd: string, args: string[]) =>
    (await gitOutput(cwd, args)).trim();
  const verifyOriginDestination = async (cwd: string) => {
    const fetch = await gitOutput(cwd, [
      "remote",
      "get-url",
      "--all",
      "origin",
    ]);
    const push = await gitOutput(cwd, [
      "remote",
      "get-url",
      "--push",
      "--all",
      "origin",
    ]);
    const isSingleUrl = (output: string) =>
      /^[^\n]+\n$/.test(output) && output.trim().length > 0;
    if (!isSingleUrl(fetch) || !isSingleUrl(push))
      throw new Error("Origin must have one fetch URL and one push URL");
    if (fetch !== push)
      throw new Error("Origin fetch and push URLs must match");
  };
  const validateBranch = async (cwd: string, branch: string) => {
    if (!branch || branch.startsWith("-"))
      throw new Error("Invalid branch name");
    await git(cwd, ["check-ref-format", `refs/heads/${branch}`]);
  };
  const requireSha = (sha: string) => {
    if (!isSha(sha)) throw new Error("A complete commit SHA is required");
  };
  const getRemoteBranchSha = async (cwd: string, branch: string) => {
    await validateBranch(cwd, branch);
    let output: string;
    try {
      output = await git(cwd, [
        "ls-remote",
        "--exit-code",
        "--heads",
        "origin",
        `refs/heads/${branch}`,
      ]);
    } catch (error) {
      if (failureStatus(error) === 2) return null;
      throw error;
    }
    const lines = output.split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1)
      throw new Error("Remote branch lookup was ambiguous");
    const [sha, ref] = lines[0].split(/\s+/);
    if (!isSha(sha) || ref !== `refs/heads/${branch}`)
      throw new Error("Remote branch lookup returned an invalid identity");
    return sha;
  };
  return {
    async fetchBranch(cwd, branch) {
      await validateBranch(cwd, branch);
      await git(cwd, [
        "fetch",
        "--no-tags",
        "origin",
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ]);
    },
    async resolveRefSha(cwd, ref) {
      try {
        return await git(cwd, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${ref}^{commit}`,
        ]);
      } catch (error) {
        if ([1, 128].includes(failureStatus(error) as number)) return null;
        throw error;
      }
    },
    async isCommitAncestorOfRef(cwd, sha, ref) {
      requireSha(sha);
      const ancestor = await git(cwd, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${sha}^{commit}`,
      ]);
      const descendant = await git(cwd, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{commit}`,
      ]);
      if (ancestor !== sha)
        throw new Error("Commit identity differs from the requested SHA");
      try {
        await git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
        return true;
      } catch (error) {
        if (failureStatus(error) === 1) return false;
        throw error;
      }
    },
    async createDetachedCheckout(cwd, sha) {
      requireSha(sha);
      const actual = await git(cwd, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${sha}^{commit}`,
      ]);
      if (actual !== sha)
        throw new Error("Commit identity differs from the requested SHA");
      const repository = await git(cwd, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      const parent = await mkdtemp(join(tmpdir(), "gwrk-harvest-checkout-"));
      const checkoutDir = join(parent, "checkout");
      try {
        await git(cwd, ["worktree", "add", "--detach", checkoutDir, sha]);
        checkouts.set(checkoutDir, { repository, parent });
        return { checkoutDir, commitSha: sha };
      } catch (error) {
        await rm(parent, { recursive: true, force: true });
        throw error;
      }
    },
    async removeDetachedCheckout(cwd, checkoutDir) {
      const owned = checkouts.get(resolve(checkoutDir));
      if (!owned)
        throw new Error("Checkout is not owned by this harvest adapter");
      const repository = await git(cwd, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      if (repository !== owned.repository)
        throw new Error("Checkout belongs to another repository");
      await git(cwd, [
        "worktree",
        "remove",
        "--force",
        "--",
        resolve(checkoutDir),
      ]);
      await rm(owned.parent, { recursive: true, force: true });
      checkouts.delete(resolve(checkoutDir));
    },
    getRemoteBranchSha,
    async deleteRemoteBranchAtTip(cwd, branch, expectedSha) {
      requireSha(expectedSha);
      await verifyOriginDestination(cwd);
      const current = await getRemoteBranchSha(cwd, branch);
      if (current === null) return { deleted: false, reason: "missing" };
      if (current !== expectedSha)
        return { deleted: false, reason: "tip_moved" };
      try {
        await git(cwd, [
          "push",
          `--force-with-lease=refs/heads/${branch}:${expectedSha}`,
          "origin",
          `:refs/heads/${branch}`,
        ]);
        return { deleted: true };
      } catch (error) {
        const latest = await getRemoteBranchSha(cwd, branch);
        if (latest === null) return { deleted: false, reason: "missing" };
        if (latest !== expectedSha)
          return { deleted: false, reason: "tip_moved" };
        throw error;
      }
    },
  };
}
