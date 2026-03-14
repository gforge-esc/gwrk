import { performance } from "node:perf_hooks";

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
  process.exitCode = 0;

  try {
    await fn();
    // If the function set process.exitCode, use it
    if (process.exitCode !== undefined && process.exitCode !== 0) {
      exitCode = process.exitCode;
    }
  } catch (err: unknown) {
    if (err instanceof CommandError) {
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
    process.stderr.write(`\n${signal}\n`);
    process.exitCode = exitCode;
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
