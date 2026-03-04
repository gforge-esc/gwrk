import { execFile, execFileSync } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function execCommand(
  command: string,
  args: string[],
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error) {
        const err = error as { code?: string; status?: number };
        if (err.code === "ENOENT") {
          resolve({
            exitCode: 127,
            stdout: "",
            stderr: `Command not found: ${command}`,
          });
          return;
        }

        resolve({
          exitCode: err.status ?? 1,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      } else {
        resolve({
          exitCode: 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      }
    });
  });
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
