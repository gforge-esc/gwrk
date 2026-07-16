/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxManager } from "./sandbox.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
}));

describe("SandboxManager (Git Worktree)", () => {
  let sandboxManager: SandboxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sandboxManager = new SandboxManager("/test/root");
    // Default: the ship branch does not exist yet → `git rev-parse --verify`
    // exits non-zero (throws), so createSandbox takes the `-b` (new-branch)
    // path. Tests that exercise re-ship override this.
    (execSync as Mock).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("rev-parse --verify")) {
        throw new Error("fatal: unknown revision");
      }
      return "";
    });
  });

  it("FR-002: should create a git worktree sandbox", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    const workDir = await sandboxManager.createSandbox({
      featureId: "005-parallel-dispatch",
      phaseId: "phase-01",
      taskId: "T1",
      backend: "gemini",
      projectRoot: "/test/root",
    });

    // Should create the sandbox directory in .runs/sandboxes/
    expect(workDir).toContain(".runs/sandboxes/005-parallel-dispatch-T1-");

    // Should have called git worktree add
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining(
        "git worktree add -b sandbox/005-parallel-dispatch-T1-",
      ),
      expect.any(Object),
    );
  });

  it("TC-004: No Host Mutation - should not modify the host repository working tree", async () => {
    const workDir = await sandboxManager.createSandbox({
      featureId: "005-parallel-dispatch",
      phaseId: "phase-01",
      taskId: "T1",
      backend: "gemini",
      projectRoot: "/test/root",
    });

    expect(workDir).not.toBe("/test/root");
    expect(workDir).toContain(".runs/sandboxes/");
  });

  it("FR-002 / TR-002: should destroy a sandbox, push the branch, and create a PR if changes exist", async () => {
    const workDir = "/test/root/.runs/sandboxes/005-parallel-dispatch-T1-uuid";
    (fs.existsSync as Mock).mockReturnValue(true);

    // Mock git status --porcelain to return some changes
    (execSync as Mock).mockImplementation((cmd, opts) => {
      if (cmd === "git status --porcelain") return "M file.ts";
      if (cmd === "git rev-parse --abbrev-ref HEAD")
        return "sandbox/005-parallel-dispatch-T1-uuid";
      return "";
    });

    await sandboxManager.destroySandbox(workDir, "005-parallel-dispatch");

    // Should have checked status
    expect(execSync).toHaveBeenCalledWith(
      "git status --porcelain",
      expect.objectContaining({ cwd: workDir }),
    );

    // Should have called git push
    expect(execSync).toHaveBeenCalledWith(
      "git push origin HEAD",
      expect.objectContaining({ cwd: workDir }),
    );

    // Should have called gh pr create
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining(
        "gh pr create --base feature/005-parallel-dispatch-wip",
      ),
      expect.objectContaining({ cwd: workDir }),
    );

    // Should have called git worktree remove
    expect(execSync).toHaveBeenCalledWith(
      `git worktree remove --force ${workDir}`,
      expect.objectContaining({ cwd: "/test/root" }),
    );
  });

  it("FR-002 / TR-002: should destroy a sandbox without PR if no changes exist", async () => {
    const workDir = "/test/root/.runs/sandboxes/005-parallel-dispatch-T1-uuid";
    (fs.existsSync as Mock).mockReturnValue(true);

    // Mock git status --porcelain to return NO changes
    (execSync as Mock).mockImplementation((cmd, opts) => {
      if (cmd === "git status --porcelain") return "";
      return "";
    });

    await sandboxManager.destroySandbox(workDir, "005-parallel-dispatch");

    // Should have checked status
    expect(execSync).toHaveBeenCalledWith(
      "git status --porcelain",
      expect.objectContaining({ cwd: workDir }),
    );

    // Should NOT have called git push
    expect(execSync).not.toHaveBeenCalledWith(
      "git push origin HEAD",
      expect.any(Object),
    );

    // Should have called git worktree remove
    expect(execSync).toHaveBeenCalledWith(
      `git worktree remove --force ${workDir}`,
      expect.objectContaining({ cwd: "/test/root" }),
    );
  });

  it("PR-5: runs the worktree.setup command inside the new worktree", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    const workDir = await sandboxManager.createSandbox({
      featureId: "001-platform-foundation",
      phaseId: "phase-01",
      taskId: "T1",
      backend: "gemini",
      projectRoot: "/test/root",
      setup: "make worktree:init",
    });

    expect(execSync).toHaveBeenCalledWith(
      "make worktree:init",
      expect.objectContaining({ cwd: workDir }),
    );
  });

  it("PR-5: uses a custom base branch when provided", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    await sandboxManager.createSandbox({
      featureId: "001-platform-foundation",
      phaseId: "phase-01",
      taskId: "T1",
      backend: "gemini",
      projectRoot: "/test/root",
      baseBranch: "develop",
    });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringMatching(/git worktree add -b sandbox\/.+ .+ develop$/),
      expect.any(Object),
    );
  });

  it("PR-6: creates the worktree on a provided ship branch (feat/<feature>)", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    await sandboxManager.createSandbox({
      featureId: "001-platform-foundation",
      phaseId: "all",
      taskId: "ship",
      backend: "claude",
      projectRoot: "/test/root",
      baseBranch: "develop",
      branchName: "feat/001-platform-foundation",
    });

    expect(execSync).toHaveBeenCalledWith(
      expect.stringMatching(
        /git worktree add -b feat\/001-platform-foundation \S+ develop$/,
      ),
      expect.any(Object),
    );
  });

  it("PR-6: re-ship checks out the existing ship branch into the worktree", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    // Branch already exists → rev-parse --verify succeeds (no throw).
    (execSync as Mock).mockImplementation(() => "");

    await sandboxManager.createSandbox({
      featureId: "001-platform-foundation",
      phaseId: "all",
      taskId: "ship",
      backend: "claude",
      projectRoot: "/test/root",
      branchName: "feat/001-platform-foundation",
    });

    // Checked out into the worktree without -b (no new branch).
    expect(execSync).toHaveBeenCalledWith(
      expect.stringMatching(
        /git worktree add \S+ feat\/001-platform-foundation$/,
      ),
      expect.any(Object),
    );
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining("git worktree add -b feat/001-platform-foundation"),
      expect.any(Object),
    );
  });

  it("PR-5: destroy with autoCommitPush=false only removes the worktree (ship owns the PR)", async () => {
    const workDir = "/test/root/.runs/sandboxes/f1-T1-uuid";
    (fs.existsSync as Mock).mockReturnValue(true);
    (execSync as Mock).mockImplementation((cmd: string) => {
      if (cmd === "git status --porcelain") return "M file.ts";
      return "";
    });

    await sandboxManager.destroySandbox(workDir, "f1", {
      autoCommitPush: false,
    });

    expect(execSync).not.toHaveBeenCalledWith(
      "git push origin HEAD",
      expect.any(Object),
    );
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining("gh pr create"),
      expect.any(Object),
    );
    expect(execSync).toHaveBeenCalledWith(
      `git worktree remove --force ${workDir}`,
      expect.objectContaining({ cwd: "/test/root" }),
    );
  });

  it("PR-5: listSandboxes keeps hyphenated feature IDs intact", async () => {
    (execSync as Mock).mockReturnValue(
      "worktree /test/root/.runs/sandboxes/001-platform-foundation-T1-ab12cd34\n" +
        "branch refs/heads/sandbox/001-platform-foundation-T1-ab12cd34\n" +
        "\n",
    );

    const sandboxes = await sandboxManager.listSandboxes();

    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].featureId).toBe("001-platform-foundation");
    expect(sandboxes[0].taskId).toBe("T1");
  });

  it("TC-005: should prune all gwrk worktrees", async () => {
    await sandboxManager.pruneSandboxes();

    expect(execSync).toHaveBeenCalledWith(
      "git worktree prune",
      expect.any(Object),
    );
  });

  it("US-002: should list all active sandboxes from worktree list", async () => {
    const mockWorktreeList =
      "worktree /test/root\n" +
      "branch refs/heads/main\n" +
      "\n" +
      "worktree /test/root/.runs/sandboxes/f1-T1-uuid\n" +
      "branch refs/heads/sandbox/f1-T1-uuid\n" +
      "\n";

    (execSync as Mock).mockReturnValue(mockWorktreeList);

    const sandboxes = await sandboxManager.listSandboxes();

    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].featureId).toBe("f1");
    expect(sandboxes[0].taskId).toBe("T1");
    expect(sandboxes[0].status).toBe("running");
  });
});
