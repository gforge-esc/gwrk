/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgyAdapter } from "./adapter.js";
import { execCommand } from "../../../../utils/exec.js";

vi.mock("node:fs/promises");
vi.mock("../../../../utils/exec.js");

describe("AgyAdapter", () => {
  const adapter = new AgyAdapter();

  describe("isAvailable()", () => {
    it("returns true if agy is in PATH", async () => {
      vi.mocked(execCommand).mockResolvedValue({ exitCode: 0, stdout: "/usr/local/bin/agy", stderr: "" });
      const available = await adapter.isAvailable();
      expect(available).toBe(true);
      expect(execCommand).toHaveBeenCalledWith("which", ["agy"]);
    });

    it("returns false if agy is not in PATH", async () => {
      vi.mocked(execCommand).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "agy not found" });
      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("syncGovernance()", () => {
    it("creates AGENTS.md if it doesn't exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
      const result = await adapter.syncGovernance("/root", "new governance");

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join("/root", "AGENTS.md"),
        expect.stringContaining("new governance"),
        "utf-8"
      );
      expect(result).toContain("<!-- gwrk:begin -->");
      expect(result).toContain("new governance");
    });

    it("updates existing AGENTS.md preserving outer content", async () => {
      const existing = "Outer Before\n<!-- gwrk:begin -->\nOld\n<!-- gwrk:end -->\nOuter After";
      vi.mocked(fs.readFile).mockResolvedValue(existing);

      const result = await adapter.syncGovernance("/root", "New Rules");

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join("/root", "AGENTS.md"),
        "Outer Before\n<!-- gwrk:begin -->\nNew Rules\n<!-- gwrk:end -->\nOuter After",
        "utf-8"
      );
      expect(result).toContain("New Rules");
    });
  });

  describe("dispatch()", () => {
    it("FR-004: maps YOLO to --dangerously-skip-permissions and omits --model", async () => {
      const task = {
        prompt: "fix bug",
        agent: "agy",
        workflow: "gwrk-implement.md"
      };

      const result = await adapter.dispatch(task);

      expect(result.command).toBe("agy");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("/gwrk-implement fix bug");
      expect(result.args).toContain("--dangerously-skip-permissions");
      expect(result.args).not.toContain("--model");
    });

    it("disables sandbox for write workflows", async () => {
      const task = {
        prompt: "ship it",
        agent: "agy",
        workflow: "gwrk-ship.md"
      };

      const result = await adapter.dispatch(task);
      expect(result.args).toContain("--sandbox");
      expect(result.args[result.args.indexOf("--sandbox") + 1]).toBe("false");
    });
  });

  describe("parseResult()", () => {
    it("maps exit code 0 to success", () => {
      const result = adapter.parseResult("ok", "", 0);
      expect(result.exitCode).toBe(0);
      expect(result.errorType).toBeUndefined();
    });

    it("maps exit code 127 to command_not_found", () => {
      const result = adapter.parseResult("", "command not found", 127);
      expect(result.exitCode).toBe(127);
      expect(result.errorType).toBe("command_not_found");
    });

    it("detects turn_limit in stderr", () => {
      const result = adapter.parseResult("", "error: turn_limit reached", 1);
      expect(result.exitCode).toBe(1);
      expect(result.errorType).toBe("turn_limit");
    });

    it("normalizes exit code > 0 to 1", () => {
      const result = adapter.parseResult("", "some error", 5);
      expect(result.exitCode).toBe(1);
    });

    it("does NOT false-positive on turn_limit in stdout content", () => {
      // Regression: plan content containing "turn_limit" in spec examples
      // (e.g. errorType: "turn_limit") must not trigger error detection
      const planContent = '{"summary":"plan","intents":[{"content":"TR-009: errorType: turn_limit"}]}';
      const result = adapter.parseResult(planContent, "", 0);
      expect(result.exitCode).toBe(0);
      expect(result.errorType).toBeUndefined();
    });
  });
});
