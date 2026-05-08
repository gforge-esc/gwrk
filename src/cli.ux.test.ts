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

describe("CLI UX: Help Text Examples (Phase 11)", () => {
  const commandsWithExamples = [
    "ship",
    "define spec",
    "define plan",
    "define tasks",
    "tasks list",
    "tasks next",
    "tasks done",
    "measure pulse",
    "measure effort",
    "measure compression",
    "db runs",
    "test",
  ];

  for (const cmd of commandsWithExamples) {
    it(`gwrk ${cmd} --help shows 'Examples:' section (US-022)`, async () => {
      const { stdout, exitCode } = await runCli(`${cmd} --help`);
      expect(exitCode).toBe(0);
      expect(stdout, `Command 'gwrk ${cmd}' is missing 'Examples:' section in help`).toMatch(/Examples:/i);
    });
  }
});
