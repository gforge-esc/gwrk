/**
 * RED TEST: src/utils/agent-layer.test.ts
 * TR-003 | FR-003 | US-003
 * Contract: specs/013-agent-native-interface/contracts (Layer 2)
 * Spec: FR-003 truncation — trigger: >8192 bytes, output: first 100 lines
 *
 * RED — agent-layer.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// RED — module does not exist
import {
	processForAgent,
	stripAnsi,
	guardBinary,
	truncateOverflow,
} from "./agent-layer.js";

describe("FR-003: Agent Layer 2 Protections", () => {
	// --- US-003 Acceptance Scenario 1: ANSI stripping ---
	describe("stripAnsi", () => {
		it("US-003.1: removes ANSI escape sequences from output", () => {
			const input = "\x1b[1m\x1b[36m── gwrk status ──\x1b[0m";
			const result = stripAnsi(input);

			expect(result).toBe("── gwrk status ──");
			expect(result).not.toContain("\x1b[");
		});

		it("preserves plain text without ANSI codes", () => {
			const input = "Task T001: Create CLI entrypoint";
			const result = stripAnsi(input);
			expect(result).toBe(input);
		});

		it("handles multiple ANSI codes in sequence", () => {
			const input =
				"\x1b[32m✓\x1b[0m \x1b[1mPASS\x1b[0m: \x1b[2mT001\x1b[0m";
			const result = stripAnsi(input);
			expect(result).toBe("✓ PASS: T001");
		});
	});

	// --- US-003 Acceptance Scenario 2: Binary guard ---
	describe("guardBinary", () => {
		it("US-003.2: replaces binary content with descriptor", () => {
			// Create content with null bytes (binary indicator)
			const binaryContent = Buffer.from([
				0x48, 0x65, 0x6c, 0x00, 0x6c, 0x6f, 0x00, 0x00,
			]);
			const result = guardBinary(binaryContent.toString());

			expect(result).toMatch(/\[binary content, \d+ bytes\]/);
			expect(result).not.toContain("\x00");
		});

		it("passes through clean text content", () => {
			const clean = "This is normal text output\nWith multiple lines\n";
			const result = guardBinary(clean);
			expect(result).toBe(clean);
		});

		it("detects >30% non-printable characters as binary", () => {
			// 70% non-printable + 30% printable = binary
			const nonPrintable = String.fromCharCode(
				...Array(70).fill(0x01),
				...Array(30).fill(0x41),
			);
			const result = guardBinary(nonPrintable);
			expect(result).toMatch(/\[binary content, \d+ bytes\]/);
		});
	});

	// --- US-003 Acceptance Scenario 3: Overflow truncation ---
	describe("truncateOverflow", () => {
		it("US-003.3: truncates when output exceeds 8192 bytes", () => {
			// Create content > 8192 bytes
			const longContent = "x".repeat(100) + "\n";
			const bigInput = longContent.repeat(200); // ~20200 bytes, 200 lines
			expect(Buffer.byteLength(bigInput)).toBeGreaterThan(8192);

			const result = truncateOverflow(bigInput);

			// Contract: first 100 lines of original + truncation notice
			const lines = result.split("\n");
			expect(lines.length).toBeLessThanOrEqual(102); // 100 lines + notice + trailing
			expect(result).toContain("truncated");
			expect(result).toContain("/tmp/gwrk-output-");
		});

		it("preserves content under 8192 bytes", () => {
			const shortContent = "short output\n".repeat(10);
			expect(Buffer.byteLength(shortContent)).toBeLessThan(8192);

			const result = truncateOverflow(shortContent);
			expect(result).toBe(shortContent);
		});

		it("writes full output to /tmp file when truncating", () => {
			const longContent = ("x".repeat(100) + "\n").repeat(200);
			const result = truncateOverflow(longContent);

			// Extract the /tmp path from the truncation notice
			const match = result.match(/\/tmp\/gwrk-output-[a-f0-9]+\.txt/);
			expect(match).not.toBeNull();

			if (match) {
				expect(fs.existsSync(match[0])).toBe(true);
				const saved = fs.readFileSync(match[0], "utf-8");
				expect(saved).toBe(longContent);
				fs.rmSync(match[0]); // cleanup
			}
		});
	});

	// --- Contract: processForAgent composes all three ---
	describe("processForAgent", () => {
		it("composes stripAnsi + guardBinary + truncateOverflow", () => {
			const input = "\x1b[32mOK\x1b[0m — normal output";
			const result = processForAgent(input);

			// ANSI stripped
			expect(result).not.toContain("\x1b[");
			// Content preserved (not binary, not overflow)
			expect(result).toContain("OK");
		});

		it("TC-006: does NOT change output format (json stays json)", () => {
			const jsonInput = JSON.stringify({
				tasks: [{ id: "T001" }],
			});
			const result = processForAgent(jsonInput);

			// Should still be valid JSON after agent processing
			expect(() => JSON.parse(result)).not.toThrow();
		});
	});

	// --- Negative: empty input ---
	it("rejects invalid input: handles empty string", () => {
		const result = processForAgent("");
		expect(result).toBe("");
	});
});
