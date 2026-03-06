import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { describe, it, expect } from "vitest";

const execAsync = promisify(exec);

const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

async function runCli(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI_PATH} ${args}`);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.code || 1 };
  }
}

describe("CLI E2E Integration (UI / Command Surface)", () => {
  it("shows Foxtrot Charlie pillar hierarchy on --help", async () => {
    const { stdout, exitCode } = await runCli("--help");
    expect(exitCode).toBe(0);
    
    // Foxtrot Charlie pillars
    expect(stdout).toMatch(/define/);
    expect(stdout).toMatch(/ship/);
    expect(stdout).toMatch(/measure/);

    // Operational queries
    expect(stdout).toMatch(/tasks/);
    expect(stdout).toMatch(/db/);

    // Eliminated — must NOT appear as top-level
    expect(stdout).not.toMatch(/^\s+run\b/m);
    expect(stdout).not.toMatch(/^\s+metrics\b/m);
    expect(stdout).not.toMatch(/^\s+implement\b/m);
    expect(stdout).not.toMatch(/^\s+wud\b/m);
  });

  it("fails gracefully with correct error when spec is a Stub during analysis", async () => {
    // analyze is now internal to define, but define plan still checks stubs
    const { stderr, exitCode } = await runCli("define plan 003-slack");
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/BLOCKED.*Spec 003-slack is marked as a Stub/);
  }, 15_000);
});
