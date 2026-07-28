/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from "vitest";
import { runGate } from "./gate-runner";
import * as child_process from "node:child_process";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

describe("gate-runner", () => {
  describe("runGate", () => {
    it("should return passed: true when exit code is 0", async () => {
      vi.mocked(child_process.execFile).mockImplementation((..._args: any[]) => {
        const _callback = _args[_args.length - 1] as any;
        _callback(null, { stdout: "PASS", stderr: "" });
        return {} as any;
      });

      const result = await runGate("test-gate.sh");
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe("PASS");
    });

    it("should return passed: false when exit code is non-zero", async () => {
      vi.mocked(child_process.execFile).mockImplementation((..._args: any[]) => {
        const _callback = _args[_args.length - 1] as any;
        const error = new Error("Command failed");
        (error as any).code = 1;
        (error as any).stdout = "";
        (error as any).stderr = "FAIL";
        _callback(error, { stdout: "", stderr: "FAIL" });
        return {} as any;
      });

      const result = await runGate("test-gate.sh");
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.output).toBe("FAIL");
    });

    it("should return exitCode 127 when script is not found", async () => {
      vi.mocked(child_process.execFile).mockImplementation((..._args: any[]) => {
        const _callback = _args[_args.length - 1] as any;
        const error = new Error("spawn ENOENT");
        (error as any).code = "ENOENT";
        _callback(error, { stdout: "", stderr: "" });
        return {} as any;
      });

      const result = await runGate("missing.sh");
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(result.output).toContain("Gate script not found");
    });

    it("should combine stdout and stderr in output", async () => {
      vi.mocked(child_process.execFile).mockImplementation((..._args: any[]) => {
        const _callback = _args[_args.length - 1] as any;
        _callback(null, { stdout: "OUT", stderr: "ERR" });
        return {} as any;
      });

      const result = await runGate("test-gate.sh");
      expect(result.output).toBe("OUT\nERR");
    });

    it("runs the gate in the supplied cwd (regression: --worktree false-NO-GO)", async () => {
      // A gate's relative commands resolve against cwd. Under --worktree the
      // phase's files live in the sandbox, not process.cwd(). runGate MUST pass
      // the caller's cwd through to execFile, or a green phase false-NO-GOs.
      let seenOpts: any;
      vi.mocked(child_process.execFile).mockImplementation((..._args: any[]) => {
        // execFile(file, args, options, callback)
        seenOpts = _args[2];
        const _callback = _args[_args.length - 1] as any;
        _callback(null, { stdout: "PASS", stderr: "" });
        return {} as any;
      });

      const result = await runGate("gate.sh", { cwd: "/sandbox/worktree" });

      expect(result.passed).toBe(true);
      expect(seenOpts).toMatchObject({ cwd: "/sandbox/worktree" });
    });
  });
});
