/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TR-005 | FR-006 | US-006
 * Contract: specs/013-agent-native-interface/contracts/gate.md
 * Data Model: DM-002 (GateCheckResult)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runGateCheck, inferFeatureFromTaskId } from "./gate.js";

describe("FR-006: First-Class Gate Checking", () => {
	const projectRoot = process.cwd();
	const specsDir = path.join(projectRoot, "specs");
	const testFeature = "000-test-feature";
	const testFeatureDir = path.join(specsDir, testFeature);
	const gatesDir = path.join(testFeatureDir, "gates");

	beforeEach(() => {
		// Create a temporary feature directory with gate scripts in the real specs dir for resolution
		if (!fs.existsSync(specsDir)) fs.mkdirSync(specsDir, { recursive: true });
		fs.mkdirSync(gatesDir, { recursive: true });

		// Create a passing gate
		fs.writeFileSync(
			path.join(gatesDir, "T991-gate.sh"),
			'#!/bin/bash\necho "PASS: T991"\nexit 0\n',
			{ mode: 0o755 },
		);

		// Create a failing gate
		fs.writeFileSync(
			path.join(gatesDir, "T992-gate.sh"),
			'#!/bin/bash\necho "FAIL: assertion #1"\nexit 1\n',
			{ mode: 0o755 },
		);
	});

	afterEach(() => {
		fs.rmSync(testFeatureDir, { recursive: true, force: true });
	});

	// --- US-006 Acceptance Scenario 1: gate passes ---
	it("US-006.1: returns PASS with exit 0 for passing gate", async () => {
		const result = await runGateCheck("T991", testFeature);
		expect(result.result).toBe("PASS");
		expect(result.exitCode).toBe(0);
		expect(result.taskId).toBe("T991");
		expect(result.stdout).toContain("PASS: T991");
	});

	// --- US-006 Acceptance Scenario 2: gate fails ---
	it("US-006.2: returns FAIL with captured output for failing gate", async () => {
		const result = await runGateCheck("T992", testFeature);
		expect(result.result).toBe("FAIL");
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("FAIL: assertion #1");
	});

	// --- US-006 Acceptance Scenario 3: GateCheckResult schema ---
	it("US-006.2: returns GateCheckResult schema (DM-002)", async () => {
		const result = await runGateCheck("T991", testFeature);
		expect(result).toHaveProperty("taskId");
		expect(result).toHaveProperty("feature");
		expect(result).toHaveProperty("gatePath");
		expect(result).toHaveProperty("result");
		expect(result).toHaveProperty("exitCode");
		expect(result).toHaveProperty("stdout");
		expect(result).toHaveProperty("stderr");
		expect(result).toHaveProperty("durationMs");
		expect(typeof result.durationMs).toBe("number");
	});

	// --- Negative: gate script not found ---
	it("rejects invalid input: gate script not found with corrective message", async () => {
		await expect(runGateCheck("T999", testFeature)).rejects.toThrow(
			/Gate script not found.*Run 'gwrk gate/,
		);
	});

	// --- Contract: gate script path resolution ---
	it("resolves gate script path from taskId and feature", async () => {
		const result = await runGateCheck("T991", testFeature);
		expect(result.gatePath).toBe(`specs/${testFeature}/gates/T991-gate.sh`);
	});

	// --- Contract: feature inference ---
	it("infers feature from taskId when exactly one match", () => {
		const feature = inferFeatureFromTaskId("T991");
		expect(feature).toBe(testFeature);
	});

	it("throws exit 2 when no matches found for taskId", () => {
		try {
			inferFeatureFromTaskId("T999");
			expect.fail("Should have thrown");
		} catch (e: any) {
			expect(e.exitCode).toBe(2);
			expect(e.message).toContain("Feature required");
		}
	});

	it("gate command is registered in cli.ts", () => {
		const cliSource = fs.readFileSync(
			path.resolve("src/cli.ts"),
			"utf-8",
		);
		expect(cliSource).toContain("gateCommand");
	});
});

// 023 patch (execution layer): a multi-line inline gate must fail if ANY
// command fails, not only the last. Before this fix, execSync ran the script
// under `sh` with no `set -e`, so PASS/FAIL was decided solely by the last
// command's exit code. A gate whose real assertion (e.g. `make test:db`)
// failed but whose final line (e.g. `config:inspect`) passed reported PASS — a
// false green (observed on data-dashboard 002-metric-model).
describe("023 patch: inline gate execution enforces every command", () => {
	const testFeature = "000-gate-enforce";

	it("FAILs when an earlier command fails even if the last one passes", async () => {
		const result = await runGateCheck(
			"T-enforce-1",
			testFeature,
			"false\ntrue",
		);
		expect(result.result).toBe("FAIL");
		expect(result.exitCode).not.toBe(0);
	});

	it("does NOT false-fail a passing `cmd | grep -q` assertion", async () => {
		// A producer that emits the match then keeps writing must PASS. Under
		// `pipefail`, grep -q closing the pipe early SIGPIPEs the producer
		// (exit 141) and false-fails a true assertion; `set -e` alone avoids it.
		const result = await runGateCheck(
			"T-enforce-2",
			testFeature,
			"{ echo db/definitions; echo more_tap_output; } | grep -q db/definitions",
		);
		expect(result.result).toBe("PASS");
	});

	it("PASSes when every command in a multi-line gate passes", async () => {
		const result = await runGateCheck(
			"T-enforce-3",
			testFeature,
			"echo one\ntrue\necho two",
		);
		expect(result.result).toBe("PASS");
	});
});
