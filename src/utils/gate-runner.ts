import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFilePromise = promisify(execFile);

export interface GateResult {
  passed: boolean;
  exitCode: number;
  output: string;
}

/**
 * Programmatic gate execution (FR-003).
 * Runs a gate script and returns a structured result.
 *
 * @param scriptPath - Absolute or relative path to the gate script
 * @returns Promise<GateResult>
 */
export async function runGate(scriptPath: string): Promise<GateResult> {
  try {
    const { stdout, stderr } = await execFilePromise(scriptPath);
    const output = [stdout, stderr].filter(Boolean).map(s => s.trim()).join("\n");
    return {
      passed: true,
      exitCode: 0,
      output,
    };
  } catch (error: unknown) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };

    const exitCode = typeof err.code === "number" ? err.code : 1;
    const output = [err.stdout, err.stderr].filter(Boolean).map(s => s!.trim()).join("\n");

    if (err.code === "ENOENT") {
      return {
        passed: false,
        exitCode: 127,
        output: `Gate script not found: ${scriptPath}`,
      };
    }

    return {
      passed: false,
      exitCode,
      output,
    };
  }
}
