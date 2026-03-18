/**
 * RED TEST: src/utils/output.test.ts
 * TR-002 | FR-002 | US-002
 * Contract: specs/013-agent-native-interface/contracts/output.md
 *
 * Tests for CommandOutput — text (default) and JSON formats.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOutput } from "./output.js";
import type { CommandOutput } from "./output.js";

describe("FR-002: JSON Output (CommandOutput)", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// --- US-002 Acceptance Scenario 1: --format json produces valid JSON ---
	describe("json mode", () => {
		it("US-002.1: write(object) emits JSON.stringify to stdout", () => {
			const out = createOutput("json");
			const data = { tasks: [{ id: "T001", title: "test" }] };
			out.write(data);

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			const parsed = JSON.parse(stdout.trim());
			expect(parsed).toEqual(data);
		});

		it("US-002.1: write(string) wraps in JSON on stdout", () => {
			const out = createOutput("json");
			out.write("hello");

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(() => JSON.parse(stdout.trim())).not.toThrow();
		});

		it("US-002.1: info() goes to stderr even in json mode", () => {
			const out = createOutput("json");
			out.info("loading specs...");

			const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(stderr).toContain("loading specs...");

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(stdout).not.toContain("loading specs...");
		});

		it("json mode: isJson is true", () => {
			const out = createOutput("json");
			expect(out.isJson).toBe(true);
		});
	});

	// --- Contract: text mode (default, no format flag) ---
	describe("text mode (default)", () => {
		it("write(string) emits text to stdout", () => {
			const out = createOutput();
			out.write("Task T001: Create CLI");

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(stdout).toContain("Task T001: Create CLI");
		});

		it("write(object) emits String(data) to stdout", () => {
			const out = createOutput();
			const data = { name: "test" };
			out.write(data);

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			// In text mode, objects are stringified as text
			expect(stdout).toBeDefined();
			expect(stdout.length).toBeGreaterThan(0);
		});

		it("info() goes to stderr in text mode", () => {
			const out = createOutput();
			out.info("debug info");

			const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(stderr).toContain("debug info");
		});

		it("text mode: isJson is false", () => {
			const out = createOutput();
			expect(out.isJson).toBe(false);
		});

		it("undefined format: isJson is false", () => {
			const out = createOutput(undefined);
			expect(out.isJson).toBe(false);
		});
	});

	// --- Contract: write() ALWAYS stdout, info() ALWAYS stderr ---
	it("write() never writes to stderr", () => {
		const out = createOutput("json");
		out.write({ data: "test" });

		const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stderr).not.toContain("data");
	});

	it("info() never writes to stdout", () => {
		const out = createOutput();
		out.info("should be on stderr only");

		const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stdout).not.toContain("should be on stderr only");
	});

	// --- Negative: invalid format ---
	it("rejects invalid input: unknown format value", () => {
		// FR-002 error state: invalid format should throw
		expect(() => createOutput("xml")).toThrow();
	});

	// --- Contract: CommandOutput interface shape ---
	it("createOutput returns object with write, info, and isJson", () => {
		const out = createOutput();
		expect(typeof out.write).toBe("function");
		expect(typeof out.info).toBe("function");
		expect(typeof out.isJson).toBe("boolean");
	});
});
