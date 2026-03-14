/**
 * RED TEST: src/utils/output.test.ts
 * TR-002 | FR-002 | US-002
 * Contract: specs/013-agent-native-interface/contracts/output.md
 *
 * RED — output.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOutput } from "./output.js"; // RED — module does not exist
import type { CommandOutput } from "./output.js"; // RED — type does not exist

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
	});

	// --- US-002 Acceptance Scenario 2: --help mentions --format json ---
	// (This is an E2E concern tested by gate T011, not unit testable here)

	// --- US-002 Acceptance Scenario 3: --format json on non-queryable command ---
	// (Handled at CLI level, not by CommandOutput — gate T004 tests this)

	// --- Contract: human mode ---
	describe("human mode", () => {
		it("write(string) emits text to stdout", () => {
			const out = createOutput("human");
			out.write("Task T001: Create CLI");

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(stdout).toContain("Task T001: Create CLI");
		});

		it("write(object) emits String(data) to stdout", () => {
			const out = createOutput("human");
			const data = { name: "test" };
			out.write(data);

			const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
			// In human mode, objects are stringified as text
			expect(stdout).toBeDefined();
			expect(stdout.length).toBeGreaterThan(0);
		});

		it("info() goes to stderr in human mode", () => {
			const out = createOutput("human");
			out.info("debug info");

			const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
			expect(stderr).toContain("debug info");
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
		const out = createOutput("human");
		out.info("should be on stderr only");

		const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
		expect(stdout).not.toContain("should be on stderr only");
	});

	// --- Negative: invalid format ---
	it("rejects invalid input: unknown format value", () => {
		// FR-002 error state: invalid format should throw or be handled
		expect(() => createOutput("xml" as "human" | "json")).toThrow();
	});

	// --- Contract: CommandOutput interface shape ---
	it("createOutput returns object with write and info methods", () => {
		const out = createOutput("human");
		expect(typeof out.write).toBe("function");
		expect(typeof out.info).toBe("function");
	});
});
