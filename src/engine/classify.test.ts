/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * RED TEST: src/engine/classify.test.ts
 * FR (plan Phase 3.3) | US (derived from plan)
 * No contract file — classification is plan-defined, not spec-mandated
 *
 * RED — classify.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// RED — module does not exist
import { classifyChange } from "./classify.js";

describe("Task Classification Engine", () => {
	const testRoot = "/tmp/gwrk-test-classify";

	beforeEach(() => {
		fs.mkdirSync(path.join(testRoot, "src", "commands"), {
			recursive: true,
		});
	});

	afterEach(() => {
		fs.rmSync(testRoot, { recursive: true, force: true });
	});

	// --- Classification: greenfield (file doesn't exist) ---
	it("classifies as 'greenfield' when target file does not exist", () => {
		const result = classifyChange({
			files: ["src/utils/signal.ts"],
			rootDir: testRoot,
		});

		expect(result).toBe("greenfield");
	});

	// --- Classification: change (file exists, modifies behavior) ---
	it("classifies as 'change' when target file exists and task modifies behavior", () => {
		fs.writeFileSync(
			path.join(testRoot, "src", "commands", "status.ts"),
			'export const statusCommand = {};',
		);

		const result = classifyChange({
			files: ["src/commands/status.ts"],
			rootDir: testRoot,
			modifiesBehavior: true,
		});

		expect(result).toBe("change");
	});

	// --- Classification: refactor (file exists, changes structure not behavior) ---
	it("classifies as 'refactor' when file exists and task changes structure only", () => {
		fs.writeFileSync(
			path.join(testRoot, "src", "commands", "status.ts"),
			'export const statusCommand = {};',
		);

		const result = classifyChange({
			files: ["src/commands/status.ts"],
			rootDir: testRoot,
			modifiesBehavior: false,
		});

		expect(result).toBe("refactor");
	});

	// --- Classification: noop (no code change) ---
	it("classifies as 'noop' when task has no file changes", () => {
		const result = classifyChange({
			files: [],
			rootDir: testRoot,
		});

		expect(result).toBe("noop");
	});

	// --- Multiple files: mixed classification picks highest ---
	it("classifies as 'greenfield' if any file is greenfield", () => {
		fs.writeFileSync(
			path.join(testRoot, "src", "commands", "status.ts"),
			'export const statusCommand = {};',
		);

		const result = classifyChange({
			files: [
				"src/commands/status.ts", // exists
				"src/utils/signal.ts", // doesn't exist
			],
			rootDir: testRoot,
		});

		// Greenfield takes precedence (more work than change)
		expect(result).toBe("greenfield");
	});

	// --- Negative: invalid rootDir ---
	it("rejects invalid input: handles non-existent rootDir", () => {
		expect(() =>
			classifyChange({
				files: ["src/utils/signal.ts"],
				rootDir: "/nonexistent/path",
			}),
		).toThrow();
	});
});
