import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execAsync = promisify(exec);

const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

async function runCli(
  args: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI_PATH} ${args}`);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.code || 1,
    };
  }
}

describe("CLI E2E Integration (UI / Command Surface)", () => {
  it("shows exactly the settled hierarchy on --help (US-018)", async () => {
    const { stdout, exitCode } = await runCli("--help");
    expect(exitCode).toBe(0);

    // Branding and Headers
    expect(stdout).toMatch(/🦩 gwrk/);
    expect(stdout).toMatch(/Foxtrot Charlie/);
    expect(stdout).toMatch(/Operations/);

    // Foxtrot Charlie pillars must be present
    expect(stdout).toMatch(/^\s+define\s+/m);
    expect(stdout).toMatch(/^\s+ship\s+/m);
    expect(stdout).toMatch(/^\s+measure\s+/m);

    // Core operational commands must be present
    expect(stdout).toMatch(/^\s+init\s+/m);
    expect(stdout).toMatch(/^\s+tasks\s+/m);
    expect(stdout).toMatch(/^\s+db\s+/m);

    // Eliminated / Hidden — must NOT appear as top-level in help
    const hidden = [
      "run",
      "metrics",
      "implement",
      "specify",
      "plan",
      "analyze",
      "effort",
      "pulse",
      "compression",
      "server",
      "status",
      "new",
      "record",
    ];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(
        stdout,
        `Command ${cmd} should not be in top-level help`,
      ).not.toMatch(regex);
    }
  });

  it("gwrk define --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("define --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+spec\b/m);
    expect(stdout).toMatch(/^\s+plan\b/m);
    expect(stdout).toMatch(/^\s+tasks\b/m);

    // No other subcommands
    const hidden = ["analyze", "specify", "generate", "implement", "ship"];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(stdout).not.toMatch(regex);
    }
  });

  it("gwrk ship --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("ship --help");
    expect(exitCode).toBe(0);
    // Ship is now a standalone command with options, no subcommands
    expect(stdout).toMatch(/--dry-run/);
    expect(stdout).toMatch(/--max-iterations/);
    expect(stdout).toMatch(/--ci-timeout/);

    // No subcommands should exist
    const hidden = ["implement", "done", "run", "start"];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(stdout).not.toMatch(regex);
    }
  });

  it("gwrk measure --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("measure --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+pulse\b/m);
    expect(stdout).toMatch(/^\s+effort\b/m);
    expect(stdout).toMatch(/^\s+compression\b/m);

    // No other subcommands
    const hidden = ["metrics", "status", "runs", "stats"];
    for (const cmd of hidden) {
      const regex = new RegExp(`^\\s+${cmd}\\b`, "m");
      expect(stdout).not.toMatch(regex);
    }
  });

  it("gwrk db --help shows settled hierarchy (US-018)", async () => {
    const { stdout, exitCode } = await runCli("db --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+runs\b/m);
    expect(stdout).toMatch(/^\s+stats\b/m);

    // record should be hidden
    expect(stdout).not.toMatch(/^\s+record\b/m);
  });

  it("gwrk tasks --help shows settled hierarchy (US-005, US-006)", async () => {
    const { stdout, exitCode } = await runCli("tasks --help");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\s+list\b/m);
    expect(stdout).toMatch(/^\s+next\b/m);
    expect(stdout).toMatch(/^\s+done\b/m);
  });

  it("fails gracefully with correct error when spec is a Stub during analysis", async () => {
    // analyze is now internal to define, but define plan still checks stubs
    const { stderr, exitCode } = await runCli("define plan 003-slack");
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/BLOCKED.*Spec 003-slack is marked as a Stub/);
  }, 15_000);
});
