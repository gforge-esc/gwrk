import { describe, it, expect } from "vitest";
import { run, execCommand, runGate } from "./exec";
import path from "node:path";
import fs from "node:fs";

describe("exec utilities", () => {
  describe("run", () => {
    it("should resolve on successful command execution without input", async () => {
      await expect(run("node", ["-e", "process.exit(0)"])).resolves.toBeUndefined();
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
      const script = "let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => process.exit(input === 'hello' ? 0 : 1));";
      await expect(run("node", ["-e", script], { input: "hello" })).resolves.toBeUndefined();
    });

    it("should pass input to child process stdin and fail if wrong input", async () => {
      const script = "let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => process.exit(input === 'hello' ? 0 : 1));";
      await expect(run("node", ["-e", script], { input: "wrong" })).rejects.toThrow();
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
      const script = "let input = ''; process.stdin.on('data', d => input += d); process.stdin.on('end', () => console.log(input.toUpperCase()));";
      const res = await execCommand("node", ["-e", script], "hello stdin");
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe("HELLO STDIN");
    });

    it("should return exitCode and stderr on failure", async () => {
      const res = await execCommand("node", ["-e", "console.error('error log'); process.exit(2)"]);
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

  describe("runGate", () => {
    it("should return exitCode 127 for ENOENT when script is missing", () => {
      const res = runGate("missing-gate-script.sh");
      expect(res.exitCode).toBe(127);
      expect(res.stderr).toContain("Gate script not found");
      expect(res.stdout).toBe("");
    });

    it("should return success and stdout for a successful gate", () => {
      const tempScript = path.join(process.cwd(), ".temp-gate-success.sh");
      fs.writeFileSync(tempScript, "#!/usr/bin/env bash\necho 'Gate passed.'\nexit 0");
      fs.chmodSync(tempScript, "755");

      try {
        const res = runGate(tempScript);
        expect(res.exitCode).toBe(0);
        expect(res.stdout.trim()).toBe("Gate passed.");
        expect(res.stderr).toBe("");
      } finally {
        fs.unlinkSync(tempScript);
      }
    });

    it("should return failure, stdout, and stderr for a failed gate", () => {
      const tempScript = path.join(process.cwd(), ".temp-gate-fail.sh");
      fs.writeFileSync(tempScript, "#!/usr/bin/env bash\necho 'Gate stdout'\necho 'Gate stderr' >&2\nexit 1");
      fs.chmodSync(tempScript, "755");

      try {
        const res = runGate(tempScript);
        expect(res.exitCode).toBe(1);
        expect(res.stdout.trim()).toBe("Gate stdout");
        expect(res.stderr.trim()).toBe("Gate stderr");
      } finally {
        fs.unlinkSync(tempScript);
      }
    });
  });
});
