/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFilePromise = promisify(execFile);

/**
 * Shared gate execution output capture buffer limit (16 MiB).
 * Aligned with test runner execution buffer (src/engine/test-runner.ts).
 */
export const GATE_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export function isMaxBufferError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; name?: unknown; message?: unknown };
  return (
    err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || err.code === "ENOBUFS"
  );
}

interface GateResult {
  passed: boolean;
  exitCode: number;
  output: string;
}

/**
 * Programmatic gate execution (FR-003).
 * Runs a gate script and returns a structured result.
 *
 * @param scriptPath - Absolute or relative path to the gate script
 * @param opts.cwd - Working directory to run the gate in. MUST be passed by
 *   ship (`this.config.cwd`) and gate (`projectRoot`): a gate's relative commands
 *   (`node --test tests/…`, `make …`, `grep … src/`) resolve against cwd, and
 *   under `--worktree` the phase's files live in the sandbox, not the process's
 *   cwd. Omitting it inherits `process.cwd()` and false-fails a green phase.
 * @returns Promise<GateResult>
 */
export async function runGate(
  scriptPath: string,
  opts?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    maxBuffer?: number;
  },
): Promise<GateResult> {
  const maxBuffer = opts?.maxBuffer ?? GATE_MAX_BUFFER_BYTES;
  try {
    const { stdout, stderr } = await execFilePromise(scriptPath, [], {
      cwd: opts?.cwd,
      env: opts?.env,
      maxBuffer,
      ...(opts?.timeoutMs === undefined
        ? {}
        : { timeout: opts.timeoutMs, killSignal: "SIGKILL" as const }),
    });
    const output = [stdout, stderr]
      .filter(Boolean)
      .map((s) => s.trim())
      .join("\n");
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
      killed?: boolean;
      signal?: NodeJS.Signals;
    };

    const exitCode = typeof err.code === "number" ? err.code : 1;
    const output = [err.stdout, err.stderr]
      .filter(Boolean)
      .map((s) => s?.trim())
      .join("\n");

    if (opts?.timeoutMs && err.killed && err.signal === "SIGKILL") {
      return {
        passed: false,
        exitCode,
        output: [`Gate timed out after ${opts.timeoutMs} ms`, output]
          .filter(Boolean)
          .join("\n"),
      };
    }

    if (isMaxBufferError(err)) {
      return {
        passed: false,
        exitCode,
        output: [
          `Gate output exceeded maximum buffer limit (${maxBuffer} bytes)`,
          output,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    if (err.code === "EACCES") {
      return {
        passed: false,
        exitCode: 126,
        output: `Gate script not executable: ${scriptPath} (run chmod +x)`,
      };
    }

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
