import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPhaseBranch,
  mergePhaseBack,
  isClean,
  hasConflicts,
} from "./git-manager.js";
import { execFile } from "node:child_process";

vi.mock("node:child_process");

// FR-010: Git branch lifecycle
describe("FR-010: Git Branch Manager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // US-006 #1: createPhaseBranch creates correct branch name
  describe("createPhaseBranch()", () => {
    it("US-006 #1: creates phase/<feature>-<phase> from feature/<feature>-wip", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(null, "", "");
        return {} as any;
      });

      const branchName = await createPhaseBranch("001-cli-core", "phase-01");
      expect(branchName).toBe("phase/001-cli-core-phase-01");

      // Verify git checkout -b was called with correct args
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([
          "checkout",
          "-b",
          "phase/001-cli-core-phase-01",
        ]),
        expect.any(Object),
        expect.any(Function)
      );
    });

    // Error: feature branch not found
    it("ERROR #1: throws GitError when feature branch doesn't exist", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(new Error("pathspec 'feature/xxx-wip' did not match"), "", "");
        return {} as any;
      });

      await expect(
        createPhaseBranch("xxx", "phase-01")
      ).rejects.toThrow(/Branch feature\/xxx-wip not found/);
    });

    // Error: dirty working tree
    it("ERROR #2: throws GitError when working tree is dirty", async () => {
      const mockExecFile = vi.mocked(execFile);
      // First call: isClean check returns dirty
      mockExecFile.mockImplementation((_cmd, args, _opts, cb: any) => {
        if (Array.isArray(args) && args.includes("status")) {
          cb(null, "M src/server/index.ts\n", "");
        } else {
          cb(null, "", "");
        }
        return {} as any;
      });

      await expect(
        createPhaseBranch("001-cli-core", "phase-01")
      ).rejects.toThrow(/uncommitted changes/);
    });
  });

  // US-006 #2: mergePhaseBack merges into feature branch
  describe("mergePhaseBack()", () => {
    it("US-006 #2: merges phase branch back into feature branch", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(null, "", "");
        return {} as any;
      });

      await mergePhaseBack("001-cli-core", "phase-01");

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["merge", "phase/001-cli-core-phase-01"]),
        expect.any(Object),
        expect.any(Function)
      );
    });

    // Error: merge conflict
    it("ERROR #3: throws GitError on merge conflict", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(new Error("CONFLICT (content): Merge conflict in src/foo.ts"), "", "");
        return {} as any;
      });

      await expect(
        mergePhaseBack("001-cli-core", "phase-01")
      ).rejects.toThrow(/Merge conflict/);
    });
  });

  // isClean()
  describe("isClean()", () => {
    it("US-006 #3: returns true when working tree is clean", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(null, "", ""); // Empty output = clean
        return {} as any;
      });

      const result = await isClean("/workspace");
      expect(result).toBe(true);
    });

    it("US-006 #4: returns false when working tree has changes", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(null, "M src/foo.ts\n", "");
        return {} as any;
      });

      const result = await isClean("/workspace");
      expect(result).toBe(false);
    });
  });

  // hasConflicts()
  describe("hasConflicts()", () => {
    it("US-006 #5: returns false for clean merge", async () => {
      const mockExecFile = vi.mocked(execFile);
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
        cb(null, "", "");
        return {} as any;
      });

      const result = await hasConflicts("001-cli-core", "phase-01");
      expect(result).toBe(false);
    });
  });
});
