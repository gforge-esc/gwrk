/**
 * CommandOutput interface for abstracting stdout/stderr writes.
 * Supports human and JSON formats.
 * Implements FR-002, TC-006 per output.md contract.
 */
export interface CommandOutput {
	/** Write data to stdout */
	write(data: string | object): void;
	/** Write info message to stderr */
	info(msg: string): void;
}

/**
 * Factory to create a CommandOutput instance based on the desired format.
 *
 * @param format - 'human' or 'json'
 * @throws Error if format is not supported.
 */
export function createOutput(format: "human" | "json"): CommandOutput {
	if (format === "human") {
		return {
			write(data: string | object): void {
				const output = typeof data === "string" ? data : String(data);
				process.stdout.write(output);
			},
			info(msg: string): void {
				process.stderr.write(`${msg}\n`);
			},
		};
	}

	if (format === "json") {
		return {
			write(data: string | object): void {
				const output =
					typeof data === "string"
						? JSON.stringify(data)
						: JSON.stringify(data, null, 2);
				process.stdout.write(`${output}\n`);
			},
			info(msg: string): void {
				process.stderr.write(`${msg}\n`);
			},
		};
	}

	throw new Error(`Unknown format: ${format}. Supported: human, json`);
}
