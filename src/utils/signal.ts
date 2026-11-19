/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { performance } from "node:perf_hooks";
import {
  CliExit,
  getCliExitCode,
  setCliExitCode,
  writeScopedStderr,
} from "../adapters/cli/output-scope.js";

/**
 * Custom error class for gwrk commands that allows specifying an exit code.
 */
export class CommandError extends Error {
  constructor(
    message: string,
    public exitCode = 1,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/**
 * Higher-order function wrapping every Commander action to emit an operational signal.
 * Implements FR-001, TC-005, TC-007 per signal.md contract.
 *
 * @param name - The name of the command being executed.
 * @param fn - The async function containing the command logic.
 */
export async function withSignal(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  const start = performance.now();
  let exitCode = 0;
  let errorMsg = "";

  // Reset exitCode before running
  setCliExitCode(0);

  try {
    await fn();
    exitCode = getCliExitCode();
  } catch (err: unknown) {
    if (err instanceof CliExit) {
      exitCode = err.exitCode;
    } else if (err instanceof CommandError) {
      exitCode = err.exitCode;
      errorMsg = err.message;
    } else if (err instanceof Error) {
      exitCode = 1;
      errorMsg = err.message;
    } else if (typeof err === "string") {
      exitCode = 1;
      errorMsg = err;
    } else {
      exitCode = 1;
      errorMsg = "Unknown error";
    }
  } finally {
    const duration = performance.now() - start;
    const formattedDuration = formatDuration(duration);

    let signal = `[exit:${exitCode} | ${formattedDuration}]`;
    if (exitCode !== 0 && errorMsg) {
      signal += ` ${name}: ${errorMsg}`;
    }

    // Ensure it starts on a new line and ends with a newline
    writeScopedStderr(`\n${signal}\n`);
    setCliExitCode(exitCode);
  }
}

/**
 * Formats duration in milliseconds to either Nms (if < 1s) or N.Ns (if >= 1s).
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
