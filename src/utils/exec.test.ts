/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { execCommand, run } from "./exec";

describe("exec utilities", () => {
  describe("run", () => {
    it("should resolve on successful command execution without input", async () => {
      await expect(
        run("node", ["-e", "process.exit(0)"]),
      ).resolves.toBeUndefined();
    });

    it("should reject with exitCode on failure", async () => {
      try {
        await run("node", ["-e", "process.exit(42)"]);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.message).toBe("Process exited with code 42");
        expect(err.exitCode).toBe(42);
      }
    });

    it("should reject on child process 'error' event (e.g., command not found)", async () => {
      await expect(run("nonexistent-command-12345", [])).rejects.toThrow();
    });

    it("should pass input to child process stdin", async () => {
      // Create a node script that reads stdin and exits with 0 only if input is 'hello'
      const script =
        "let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => process.exit(input === 'hello' ? 0 : 1));";
      await expect(
        run("node", ["-e", script], { input: "hello" }),
      ).resolves.toBeUndefined();
    });

    it("should pass input to child process stdin and fail if wrong input", async () => {
      const script =
        "let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => process.exit(input === 'hello' ? 0 : 1));";
      await expect(
        run("node", ["-e", script], { input: "wrong" }),
      ).rejects.toThrow();
    });
  });

  describe("execCommand", () => {
    it("should return stdout on success", async () => {
      const res = await execCommand("node", ["-e", "console.log('hello')"]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe("hello");
      expect(res.stderr).toBe("");
    });

    it("should pass stdin correctly", async () => {
      const script =
        "let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => console.log(input.toUpperCase()));";
      const res = await execCommand("node", ["-e", script], "hello stdin");
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe("HELLO STDIN");
    });

    it("should return exitCode and stderr on failure", async () => {
      const res = await execCommand("node", [
        "-e",
        "console.error('error log'); process.exit(2)",
      ]);
      expect(res.exitCode).toBe(2);
      expect(res.stderr.trim()).toBe("error log");
      expect(res.stdout.trim()).toBe("");
    });

    it("should gracefully handle ENOENT when command is not found", async () => {
      const res = await execCommand("nonexistent-command-12345", []);
      expect(res.exitCode).toBe(127);
      expect(res.stderr).toContain("Command not found");
      expect(res.stdout).toBe("");
    });
  });

});
