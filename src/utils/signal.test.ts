/**
 * RED TEST: src/utils/signal.test.ts
 * TR-001 | FR-001 | US-001
 * Contract: specs/013-agent-native-interface/contracts/signal.md
 *
 * RED — signal.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withSignal } from "./signal.js"; // RED — module does not exist

describe("FR-001: Operational Signal (withSignal)", () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	// --- US-001 Acceptance Scenario 1: Successful command ---
	it("US-001.1: emits [exit:0 | Nms] on stderr for successful command", async () => {
		await withSignal("status", async () => {
			/* success */
		});

		expect(process.exitCode).toBe(0);
		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toMatch(/\[exit:0 \| \d+(ms|\.\ds)\]/);
	});

	// --- US-001 Acceptance Scenario 2: Failed command ---
	it("US-001.2: emits [exit:1 | Ns] cmd: message on stderr for failed command", async () => {
		await withSignal("tasks list", async () => {
			throw new Error("feature not found");
		});

		expect(process.exitCode).toBe(1);
		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toMatch(
			/\[exit:1 \| \d+(ms|\.\ds)\] tasks list: feature not found/,
		);
	});

	// --- US-001 Acceptance Scenario 3: Pipe safety ---
	it("US-001.3: signal never appears on stdout (TC-007 pipe safety)", async () => {
		await withSignal("status", async () => {
			process.stdout.write("normal output");
		});

		const stdout = stdoutSpy.mock.calls
			.map((c) => String(c[0]))
			.join("");
		expect(stdout).not.toContain("[exit:");
	});

	// --- Contract: Duration Formatting ---
	it("formats duration as Nms when execution < 1000ms", async () => {
		await withSignal("fast", async () => {
			/* instant */
		});

		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toMatch(/\d+ms/);
	});

	it("formats duration as N.Ns when execution >= 1000ms", async () => {
		await withSignal("slow", async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100));
		});

		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toMatch(/\d+\.\d+s/);
	}, 5000);

	// --- Contract: Testability (process.exitCode, NOT process.exit) ---
	it("sets process.exitCode instead of calling process.exit()", async () => {
		await withSignal("test-cmd", async () => {});

		expect(exitSpy).not.toHaveBeenCalled();
		expect(process.exitCode).toBeDefined();
	});

	// --- Negative: non-Error throws ---
	it("rejects invalid input: handles non-Error throw (string)", async () => {
		await withSignal("bad-throw", async () => {
			throw "string-error";
		});

		expect(process.exitCode).toBe(1);
		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toContain("[exit:1");
	});

	it("rejects invalid input: handles non-Error throw (undefined)", async () => {
		await withSignal("undef-throw", async () => {
			throw undefined;
		});

		expect(process.exitCode).toBe(1);
		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toContain("[exit:1");
	});

	// --- TC-005: Signal ordering ---
	it("TC-005: signal is the last line written to stderr", async () => {
		await withSignal("ordered", async () => {
			process.stderr.write("info message\n");
		});

		const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
		const lastCall = calls[calls.length - 1];
		expect(lastCall).toMatch(/\[exit:\d/);
	});

	// --- FR-001 Error State: unhandled error ---
	it("FR-001 error state: catches unhandled async rejections", async () => {
		await withSignal("crash", async () => {
			throw new TypeError("Cannot read property 'x' of undefined");
		});

		expect(process.exitCode).toBe(1);
		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).toContain("crash:");
		expect(stderr).toContain("Cannot read property");
	});
});
