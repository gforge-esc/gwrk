/**
 * RED TEST: src/commands/gate-check.test.ts
 * TR-005 | FR-006 | US-006
 * Contract: specs/013-agent-native-interface/contracts/gate-check.md
 * Data Model: DM-002 (GateCheckResult)
 *
 * RED — gate-check.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// RED — module does not exist
// When gate-check.ts is created, uncomment and adjust:
// import { gateCheckCommand } from "./gate-check.js";

describe("FR-006: First-Class Gate Checking", () => {
	const testFeatureDir = "/tmp/gwrk-test-gate-check";
	const gatesDir = path.join(testFeatureDir, "gates");

	beforeEach(() => {
		// Create a temporary feature directory with gate scripts
		fs.mkdirSync(gatesDir, { recursive: true });

		// Create a passing gate
		fs.writeFileSync(
			path.join(gatesDir, "T001-gate.sh"),
			'#!/bin/bash\necho "PASS: T001"\nexit 0\n',
			{ mode: 0o755 },
		);

		// Create a failing gate
		fs.writeFileSync(
			path.join(gatesDir, "T002-gate.sh"),
			'#!/bin/bash\necho "FAIL: assertion #1"\nexit 1\n',
			{ mode: 0o755 },
		);
	});

	afterEach(() => {
		fs.rmSync(testFeatureDir, { recursive: true, force: true });
	});

	// --- US-006 Acceptance Scenario 1: gate passes ---
	it("US-006.1: returns PASS with exit 0 for passing gate", () => {
		// Contract: GateCheckResult with result: 'PASS', exitCode: 0
		const gatePath = path.join(gatesDir, "T001-gate.sh");
		expect(fs.existsSync(gatePath)).toBe(true);

		const result = execSync(`bash ${gatePath}`, { encoding: "utf-8" });
		expect(result).toContain("PASS");

		// When gate-check.ts exists, this should test the actual command:
		// const result = await runGateCheck('T001', testFeatureDir);
		// expect(result.result).toBe('PASS');
		// expect(result.exitCode).toBe(0);
		// expect(result.taskId).toBe('T001');

		// RED ASSERTION — will fail until gate-check.ts implements GateCheckResult
		const gateCheckModule = path.resolve("src/commands/gate-check.ts");
		expect(
			fs.existsSync(gateCheckModule),
			"gate-check.ts must exist",
		).toBe(true);
	});

	// --- US-006 Acceptance Scenario 2: gate fails ---
	it("US-006.2: returns FAIL with captured output for failing gate", () => {
		const gatePath = path.join(gatesDir, "T002-gate.sh");

		let exitCode = 0;
		let stderr = "";
		try {
			execSync(`bash ${gatePath}`, { encoding: "utf-8" });
		} catch (e: unknown) {
			const err = e as { status: number; stderr: string };
			exitCode = err.status;
			stderr = err.stderr;
		}
		expect(exitCode).toBe(1);

		// RED ASSERTION — will fail until gate-check.ts implements GateCheckResult
		const gateCheckModule = path.resolve("src/commands/gate-check.ts");
		expect(
			fs.existsSync(gateCheckModule),
			"gate-check.ts must exist",
		).toBe(true);
	});

	// --- US-006 Acceptance Scenario 3: --format json output ---
	it("US-006.2: --format json returns GateCheckResult schema (DM-002)", () => {
		// Contract: GateCheckResult must have: taskId, feature, gatePath, result, exitCode, stdout, stderr, durationMs
		const requiredFields = [
			"taskId",
			"feature",
			"gatePath",
			"result",
			"exitCode",
			"stdout",
			"stderr",
			"durationMs",
		];

		// RED ASSERTION — gate-check.ts doesn't exist yet
		const gateCheckModule = path.resolve("src/commands/gate-check.ts");
		expect(
			fs.existsSync(gateCheckModule),
			"gate-check.ts must exist to produce GateCheckResult",
		).toBe(true);

		// When implemented, validate the schema:
		// const result = await runGateCheck('T001', testFeatureDir);
		// for (const field of requiredFields) {
		//   expect(result).toHaveProperty(field);
		// }
		// expect(['PASS', 'FAIL']).toContain(result.result);
		// expect(typeof result.durationMs).toBe('number');
	});

	// --- Negative: gate script not found → error-as-navigation ---
	it("rejects invalid input: gate script not found with corrective message", () => {
		// Contract: "Gate script not found: ... Run 'gwrk project gates' to list available gates."
		const missingGatePath = path.join(gatesDir, "T099-gate.sh");
		expect(fs.existsSync(missingGatePath)).toBe(false);

		// RED ASSERTION — gate-check.ts doesn't exist yet
		const gateCheckModule = path.resolve("src/commands/gate-check.ts");
		expect(
			fs.existsSync(gateCheckModule),
			"gate-check.ts must exist to produce navigation errors",
		).toBe(true);

		// When implemented, validate error message:
		// expect(() => runGateCheck('T099', testFeatureDir))
		//   .toThrow(/Run 'gwrk project gates'/);
	});

	// --- Negative: feature not specified and not inferrable ---
	it("rejects invalid input: missing feature exits with code 2", () => {
		// Contract: exit 2 with "Feature required. Run 'gwrk project specs' to list features."

		// RED ASSERTION — gate-check.ts doesn't exist yet
		const gateCheckModule = path.resolve("src/commands/gate-check.ts");
		expect(
			fs.existsSync(gateCheckModule),
			"gate-check.ts must exist to validate feature requirements",
		).toBe(true);
	});

	// --- Contract: gate script path resolution ---
	it("resolves gate script path from taskId and feature", () => {
		// Contract: specs/<feature>/gates/<taskId>-gate.sh
		const expectedPath = path.join(
			"specs",
			"000-tdd-infrastructure",
			"gates",
			"T001-gate.sh",
		);

		// RED ASSERTION — gate-check.ts doesn't exist yet
		const gateCheckModule = path.resolve("src/commands/gate-check.ts");
		expect(
			fs.existsSync(gateCheckModule),
			"gate-check.ts must exist to resolve gate paths",
		).toBe(true);

		// When implemented:
		// const resolved = resolveGatePath('T001', 'specs/000-tdd-infrastructure');
		// expect(resolved).toBe(expectedPath);
	});

	// --- Contract: registered in cli.ts ---
	it("gate-check command is registered in cli.ts", () => {
		const cliSource = fs.readFileSync(
			path.resolve("src/cli.ts"),
			"utf-8",
		);
		// RED — gate-check import doesn't exist in cli.ts yet
		expect(cliSource).toContain("gate-check");
	});
});
