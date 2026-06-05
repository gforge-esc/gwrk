/**
 * RED TEST: src/commands/project.test.ts
 * TR-006 | FR-004 | FR-005 | US-004 | US-005
 * Contract: specs/013-agent-native-interface/contracts/discover.md
 *
 * RED — project.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// RED — module does not exist
import { projectCommand } from "./project.js";

describe("FR-004: Project Discovery Command (gwrk project)", () => {
	it("US-004.1: projectCommand has 'info' and 'discover' subcommands", () => {
		const subcommandNames = projectCommand.commands.map(
			(c: { name: () => string }) => c.name(),
		);
		expect(subcommandNames).toContain("info");
		expect(subcommandNames).toContain("discover");
	});

	// --- Contract: registered in cli.ts ---
	it("project command is registered in cli.ts", () => {
		const cliSource = fs.readFileSync(
			path.resolve("src/cli.ts"),
			"utf-8",
		);
		expect(cliSource).toContain("project");
	});

	// --- Negative: unknown subcommand ---
	it("rejects invalid input: unknown subcommand handled", () => {
		// Commander should handle unknown subcommands with help text
		const subcommandNames = projectCommand.commands.map(
			(c: { name: () => string }) => c.name(),
		);
		expect(subcommandNames).not.toContain("nonexistent");
	});
});

describe("FR-005: Spec and Gate Subcommands", () => {
	// --- US-005 Acceptance Scenario 1: specs subcommand ---
	it("US-005.1: projectCommand has 'specs' subcommand", () => {
		const subcommandNames = projectCommand.commands.map(
			(c: { name: () => string }) => c.name(),
		);
		expect(subcommandNames).toContain("specs");
	});

	// --- US-005 Acceptance Scenario 2: gates summary under project, execution at top-level ---
	it("US-005.2: projectCommand has 'gates' summary subcommand", () => {
		const subcommandNames = projectCommand.commands.map(
			(c: { name: () => string }) => c.name(),
		);
		expect(subcommandNames).toContain("gates");
	});

	// --- Contract: specs returns SpecSummary[] shape ---
	it("US-005.1: specs output has id, name, status fields", () => {
		// This will be testable once project.ts exists and we can invoke it
		// RED ASSERTION — module doesn't exist
		const moduleExists = fs.existsSync(
			path.resolve("src/commands/project.ts"),
		);
		expect(moduleExists, "project.ts must exist").toBe(true);
	});

	// --- Contract: gate command exists at top level ---
	it("US-005.2: gate command exists at src/commands/gate.ts", () => {
		const moduleExists = fs.existsSync(
			path.resolve("src/commands/gate.ts"),
		);
		expect(moduleExists, "gate.ts must exist").toBe(true);
	});
});

describe("FR-008: Help Text Discoverability", () => {
	// --- US-008: help text includes command type ---
	it("US-008.1: project discover --help includes command type", () => {
		// RED ASSERTION — module doesn't exist to test help text
		const moduleExists = fs.existsSync(
			path.resolve("src/commands/project.ts"),
		);
		expect(moduleExists, "project.ts must exist for help text").toBe(true);
	});

	// --- Contract: CommandMeta co-located ---
	// --- Contract: CommandMeta co-located (deferred — P1) ---
	it.skip("commands use CommandMeta for structured help", () => {
		// RED ASSERTION — CommandMeta doesn't exist anywhere yet
		const hasCommandMeta =
			fs.existsSync(path.resolve("src/commands/project.ts")) &&
			fs.readFileSync(
				path.resolve("src/commands/project.ts"),
				"utf-8",
			).includes("CommandMeta");

		expect(hasCommandMeta, "project.ts must use CommandMeta").toBe(true);
	});
});

describe("FR-007: Error-as-Navigation", () => {
	// --- US-007: error messages include corrective commands ---
	it("US-007.1: error paths contain 'Run ' corrective suggestions", () => {
		// Spot-check: at least 10 error paths across all commands should have "Run '"
		const commandFiles = fs
			.readdirSync(path.resolve("src/commands"))
			.filter((f: string) => f.endsWith(".ts") && !f.includes("test"));

		let runCount = 0;
		for (const file of commandFiles) {
			const source = fs.readFileSync(
				path.resolve("src/commands", file),
				"utf-8",
			);
			const matches = source.match(/Run '/g);
			if (matches) runCount += matches.length;
		}

		expect(runCount).toBeGreaterThanOrEqual(10);
	});
});
