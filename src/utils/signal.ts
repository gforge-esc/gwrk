import { performance } from "node:perf_hooks";

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

	try {
		await fn();
	} catch (err: unknown) {
		exitCode = 1;
		if (err instanceof Error) {
			errorMsg = err.message;
		} else if (typeof err === "string") {
			errorMsg = err;
		} else {
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
