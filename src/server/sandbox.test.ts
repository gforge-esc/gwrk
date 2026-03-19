import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxManager } from "./sandbox.js";
import { execSync } from "node:child_process";
import fs from "node:fs";

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
}));

describe("SandboxManager (Git Worktree)", () => {
  let sandboxManager: SandboxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sandboxManager = new SandboxManager();
  });

  it("FR-002: should create a git worktree sandbox", async () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    const workDir = await sandboxManager.createSandbox({
      featureId: "005-parallel-dispatch",
      phaseId: "phase-01",
      backend: "gemini",
      projectRoot: "/test/root",
    });

    // Should create the sandbox directory in .runs/sandboxes/
    expect(workDir).toContain(".runs/sandboxes/005-parallel-dispatch-phase-01-");
    
    // Should have called git worktree add
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("git worktree add"),
      expect.any(Object)
    );
  });

  it("FR-002: should destroy a sandbox and remove the worktree", async () => {
    const workDir = "/test/root/.runs/sandboxes/005-parallel-dispatch-phase-01-uuid";
    
    await sandboxManager.destroySandbox(workDir);

    // Should have called git worktree remove
    expect(execSync).toHaveBeenCalledWith(
      `git worktree remove --force ${workDir}`,
      expect.any(Object)
    );
  });

  it("TC-005: should prune all gwrk worktrees", async () => {
    await sandboxManager.pruneSandboxes();

    expect(execSync).toHaveBeenCalledWith(
      "git worktree prune",
      expect.any(Object)
    );
  });

  it("US-002: should list all active sandboxes from worktree list", async () => {
    const mockWorktreeList = 
      "/test/root                          (detached HEAD)\n" +
      "/test/root/.runs/sandboxes/f1-p1-uuid  (branch-f1-p1-uuid)\n";
    
    (execSync as Mock).mockReturnValue(Buffer.from(mockWorktreeList));

    const sandboxes = await sandboxManager.listSandboxes();

    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].featureId).toBe("f1");
    expect(sandboxes[0].status).toBe("running");
  });
});
