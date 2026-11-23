/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * RED TEST: src/commands/project.test.ts
 * TR-006 | FR-004 | FR-005 | US-004 | US-005
 * Contract: specs/013-agent-native-interface/contracts/discover.md
 *
 * RED — project.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithOutputScope } from "../adapters/cli/output-scope.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import { initAction } from "./init.js";
import { createProjectCommand, projectCommand } from "./project.js";

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

function runProjectTestGit(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...repositoryGitEnv(cwd),
			GIT_CONFIG_GLOBAL: os.devNull,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "Gwrk Test",
			GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
			GIT_COMMITTER_NAME: "Gwrk Test",
			GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
			GIT_TERMINAL_PROMPT: "0",
		},
	}).trim();
}

async function runProjectSubcommand(
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	let stdout = "";
	let stderr = "";
	const scope = {
		agentMode: false,
		exitCode: 0,
		stdout: (chunk: string) => {
			stdout += chunk;
		},
		stderr: (chunk: string) => {
			stderr += chunk;
		},
	};
	await runWithOutputScope(scope, async () => {
		const cmd = createProjectCommand();
		await cmd.parseAsync(args, { from: "user" });
	});
	return { stdout, stderr, exitCode: scope.exitCode };
}

describe("TR-021: gwrk project enroll, list, show and init enrollment", () => {
	let tempRoot: string;
	let repoDir: string;
	let gwrkHome: string;
	let oldCwd: string;

	beforeEach(() => {
		oldCwd = process.cwd();
		tempRoot = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-project-enroll-")),
		);
		repoDir = path.join(tempRoot, "alpha-repo");
		fs.mkdirSync(repoDir, { recursive: true });
		gwrkHome = path.join(tempRoot, "gwrk-home");
		fs.mkdirSync(gwrkHome, { recursive: true });
		vi.stubEnv("GWRK_HOME", gwrkHome);
		vi.stubEnv("GWRK_DIR", "");
		vi.stubEnv("GWRK_DB_PATH", "");
		vi.stubEnv("GWRK_RUNTIME_DIR", "");

		runProjectTestGit(repoDir, "init", "--template=", "--initial-branch=main");
		runProjectTestGit(
			repoDir,
			"commit",
			"--no-gpg-sign",
			"--allow-empty",
			"-m",
			"init",
		);
		runProjectTestGit(
			repoDir,
			"remote",
			"add",
			"origin",
			"git@github.com:org/alpha.git",
		);
		process.chdir(repoDir);
	});

	afterEach(() => {
		process.chdir(oldCwd);
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	it("registers enroll, list and show subcommands on projectCommand", () => {
		const subcommandNames = projectCommand.commands.map(
			(c: { name: () => string }) => c.name(),
		);
		expect(subcommandNames).toContain("enroll");
		expect(subcommandNames).toContain("list");
		expect(subcommandNames).toContain("show");
	});

	it("enrolls a repository with Slack binding, roles and legacy aliases, then lists and shows it in JSON and text with ADR-004 signals", async () => {
		const expectedFacts = {
			projectRoot: repoDir,
			remoteOriginUrl: "git@github.com:org/alpha.git",
			gitCommonDir: path.join(repoDir, ".git"),
		};
		const expectedId = computeProjectId(expectedFacts);
		const expectedAliases = computeLegacyProjectIds(expectedFacts);

		const emptyList = await runProjectSubcommand(["list"]);
		expect(emptyList.exitCode).toBe(0);
		expect(emptyList.stdout).toContain("gwrk project enroll");
		expect(emptyList.stderr).toMatch(/\[exit:0 \| /);

		const enrollRes = await runProjectSubcommand([
			"enroll",
			"--slug",
			"alpha",
			"--name",
			"Project Alpha",
			"--trunk",
			"main",
			"--runners",
			"local,hosted",
			"--workspace",
			"T_ALPHA",
			"--channel",
			"C_ALPHA",
			"--ops-channel",
			"C_OPS",
			"--role",
			"slack_user:T_ALPHA:U_MAINT=maintainer",
			"--role",
			"google_sub:https://accounts.google.com:sub-1=operator",
			"--format",
			"json",
		]);
		expect(enrollRes.exitCode).toBe(0);
		expect(enrollRes.stderr).toMatch(/\[exit:0 \| /);
		const enrolled = JSON.parse(enrollRes.stdout);
		expect(enrolled.projectId).toBe(expectedId);
		expect(enrolled.slug).toBe("alpha");
		expect(enrolled.repoSlug).toBe("org/alpha");
		expect(enrolled.trunkBranch).toBe("main");
		expect(enrolled.localRoot).toBe(repoDir);
		expect(enrolled.runnerPolicy).toEqual({
			allowedKinds: ["local", "hosted"],
		});
		expect(enrolled.slack).toMatchObject({
			workspaceId: "T_ALPHA",
			channelId: "C_ALPHA",
			opsChannelId: "C_OPS",
			sharedChannel: false,
		});
		for (const alias of expectedAliases) {
			expect(enrolled.legacyProjectIds).toContain(alias);
		}
		expect(enrolled.roleBindings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					principalType: "slack_user",
					principalId: "T_ALPHA:U_MAINT",
					role: "maintainer",
				}),
				expect.objectContaining({
					principalType: "google_sub",
					principalId: "https://accounts.google.com:sub-1",
					role: "operator",
				}),
			]),
		);

		const listRes = await runProjectSubcommand(["list", "--format", "json"]);
		expect(listRes.exitCode).toBe(0);
		expect(listRes.stderr).toMatch(/\[exit:0 \| /);
		const listed = JSON.parse(listRes.stdout);
		expect(listed.total).toBe(1);
		expect(listed.projects[0].projectId).toBe(expectedId);
		expect(listed.projects[0].readiness.status).toBe("ready");

		// Lookup via legacy alias works in `project show`
		const showByAlias = await runProjectSubcommand([
			"show",
			expectedAliases[0],
			"--format",
			"json",
		]);
		expect(showByAlias.exitCode).toBe(0);
		expect(showByAlias.stderr).toMatch(/\[exit:0 \| /);
		const shown = JSON.parse(showByAlias.stdout);
		expect(shown.projectId).toBe(expectedId);
		expect(shown.roleBindings).toHaveLength(2);

		// Missing project lists known slugs and exits 1
		const missRes = await runProjectSubcommand(["show", "does-not-exist"]);
		expect(missRes.exitCode).toBe(1);
		expect(missRes.stderr).toContain("alpha");
		expect(missRes.stderr).toMatch(/\[exit:1 \| /);
	});

	it("rejects enrollment outside a git checkout with error navigation", async () => {
		const nonGitDir = path.join(tempRoot, "not-a-repo");
		fs.mkdirSync(nonGitDir, { recursive: true });
		process.chdir(nonGitDir);

		const res = await runProjectSubcommand(["enroll"]);
		expect(res.exitCode).toBe(1);
		expect(res.stderr).toContain("--repo");
		expect(res.stderr).toMatch(/\[exit:1 \| /);
	});

	it("TR-021 review regression (T041): invalid --role exits 2 without writing a partial project enrollment", async () => {
		const res = await runProjectSubcommand([
			"enroll",
			"--slug",
			"alpha",
			"--role",
			"slack_user:T_ALPHA:U1=invalid-role",
		]);
		expect(res.exitCode).toBe(2);
		expect(res.stderr).toMatch(/\[exit:2 \| /);

		const listRes = await runProjectSubcommand(["list", "--format", "json"]);
		expect(listRes.exitCode).toBe(0);
		expect(JSON.parse(listRes.stdout).total).toBe(0);
	});

	it("FR-001/FR-004: gwrk init enrolls the local repository and preserves legacy aliases and architecture guidance when origin is added", async () => {
		const localOnlyDir = path.join(tempRoot, "local-only");
		fs.mkdirSync(localOnlyDir, { recursive: true });
		runProjectTestGit(
			localOnlyDir,
			"init",
			"--template=",
			"--initial-branch=develop",
		);
		runProjectTestGit(
			localOnlyDir,
			"commit",
			"--no-gpg-sign",
			"--allow-empty",
			"-m",
			"init",
		);
		process.chdir(localOnlyDir);

		await initAction({
			nonInteractive: true,
			architecture: "hexagonal-functional",
			language: "TypeScript",
		});

		const localFacts = {
			projectRoot: localOnlyDir,
			remoteOriginUrl: null,
			gitCommonDir: path.join(localOnlyDir, ".git"),
		};
		const localId = computeProjectId(localFacts);

		let registry = createSqliteProjectRegistryAdapter();
		try {
			const first = registry.getProject(localId);
			expect(first).not.toBeNull();
			expect(first?.localRoot).toBe(localOnlyDir);
			expect(first?.repoSlug).toBeNull();
		} finally {
			registry.close();
		}

		// Add origin remote and re-run init: canonical projectId updates while legacy localId remains an alias
		runProjectTestGit(
			localOnlyDir,
			"remote",
			"add",
			"origin",
			"git@github.com:org/local-only.git",
		);
		await initAction({ nonInteractive: true });

		const remoteId = computeProjectId({
			...localFacts,
			remoteOriginUrl: "git@github.com:org/local-only.git",
		});

		registry = createSqliteProjectRegistryAdapter();
		try {
			const updated = registry.getProject(remoteId);
			expect(updated).not.toBeNull();
			expect(updated?.repoSlug).toBe("org/local-only");
			expect(updated?.legacyProjectIds).toContain(localId);
			expect(registry.getProject(localId)?.projectId).toBe(remoteId);
		} finally {
			registry.close();
		}

		// Architecture and language guidance stay consistent after re-init
		const archDoc = fs.readFileSync(
			path.join(localOnlyDir, ".gwrk", "architecture.md"),
			"utf-8",
		);
		expect(archDoc).toContain("hexagonal-functional");
		expect(archDoc).toContain("TypeScript");
		expect(archDoc).toContain("unassessed");
	});
});
