import { execFileSync } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runGate(gateScript: string): ExecResult {
  try {
    const stdout = execFileSync(gateScript, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return {
      exitCode: 0,
      stdout: stdout.toString(),
      stderr: "",
    };
  } catch (error: unknown) {
    const err = error as {
      code?: string;
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    if (err.code === "ENOENT") {
      return {
        exitCode: 127,
        stdout: "",
        stderr: `Gate script not found: ${gateScript}`,
      };
    }

    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}
