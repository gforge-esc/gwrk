/**
 * RED TEST: src/engine/discover.test.ts
 * TR-004 | FR-004 | US-004
 * Contract: specs/013-agent-native-interface/contracts/discover.md
 * Data Model: DM-001 (ProjectDiscovery)
 *
 * RED — discover.ts does not exist yet.
 * The implementing agent's job is to make these green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// RED — module does not exist
import { discoverProject } from "./discover.js";

describe("FR-004: Project Discovery Engine", () => {
	const testRoot = "/tmp/gwrk-test-discover";

	beforeEach(() => {
		fs.mkdirSync(path.join(testRoot, "specs", "001-cli-core"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(testRoot, "specs", "001-cli-core", "spec.md"),
			"# Spec\n",
		);
		fs.writeFileSync(
			path.join(testRoot, ".gwrkrc.json"),
			JSON.stringify({ project: { name: "test-project" } }),
		);
	});

	afterEach(() => {
		fs.rmSync(testRoot, { recursive: true, force: true });
	});

	// --- US-004 Acceptance Scenario 1: discover returns ProjectDiscovery ---
	it("US-004.1: returns ProjectDiscovery schema (DM-001)", async () => {
		const result = await discoverProject(testRoot);

		// DM-001 required fields
		expect(result).toHaveProperty("project");
		expect(result).toHaveProperty("git");
		expect(result).toHaveProperty("specs");
		expect(result).toHaveProperty("gates");
		expect(result).toHaveProperty("config");
	});

	// --- US-004 Acceptance Scenario 2: project metadata ---
	it("US-004.1: project.name comes from .gwrkrc.json", async () => {
		const result = await discoverProject(testRoot);

		expect(result.project.name).toBe("test-project");
		expect(typeof result.project.rootDir).toBe("string");
	});

	// --- Contract: git state from shell commands ---
	it("reads git state from git commands", async () => {
		const result = await discoverProject(testRoot);

		expect(result.git).toHaveProperty("branch");
		expect(result.git).toHaveProperty("dirty");
		expect(typeof result.git.dirty).toBe("boolean");
	});

	// --- Contract: spec inventory from filesystem ---
	it("discovers specs from specs/*/spec.md glob", async () => {
		const result = await discoverProject(testRoot);

		expect(Array.isArray(result.specs)).toBe(true);
		expect(result.specs.length).toBeGreaterThanOrEqual(1);
		expect(result.specs[0]).toHaveProperty("id");
		expect(result.specs[0]).toHaveProperty("status");
	});

	// --- Contract: status derivation (spec only = 'drafted') ---
	it("derives status 'drafted' when spec.md exists but no plan.md", async () => {
		const result = await discoverProject(testRoot);
		const spec = result.specs.find(
			(s: { id: string }) => s.id === "001-cli-core",
		);

		expect(spec).toBeDefined();
		expect(spec!.status).toBe("drafted");
	});

	// --- Contract: status derivation (plan + tasks = 'tasked') ---
	it("derives status 'tasked' when tasks.json has open tasks", async () => {
		const specDir = path.join(testRoot, "specs", "001-cli-core");
		fs.writeFileSync(path.join(specDir, "plan.md"), "# Plan\n");
		fs.mkdirSync(path.join(specDir, ".gwrk"), { recursive: true });
		fs.writeFileSync(
			path.join(specDir, ".gwrk", "tasks.json"),
			JSON.stringify({
				featureId: "001-cli-core",
				createdAt: new Date().toISOString(),
				phases: [
					{
						id: "phase-01",
						title: "Phase 1",
						tasks: [
							{
								id: "T001",
								title: "test",
								description: "test",
								status: "open",
								gateScript: "gates/T001-gate.sh",
							},
						],
					},
				],
			}),
		);

		const result = await discoverProject(testRoot);
		const spec = result.specs.find(
			(s: { id: string }) => s.id === "001-cli-core",
		);

		expect(spec!.status).toBe("tasked");
	});

	// --- TC-004: No SQLite, No Server ---
	it("TC-004: does NOT import from db/ or call localhost", async () => {
		const source = fs.readFileSync(
			path.resolve("src/engine/discover.ts"),
			"utf-8",
		);

		// Must not import from db/
		expect(source).not.toMatch(/from\s+['"].*db\//);
		// Must not reference localhost:18790
		expect(source).not.toContain("localhost:18790");
		expect(source).not.toContain("127.0.0.1:18790");
	});

	// --- Negative: missing .gwrkrc.json ---
	it("rejects invalid input: handles missing .gwrkrc.json gracefully", async () => {
		fs.rmSync(path.join(testRoot, ".gwrkrc.json"));

		const result = await discoverProject(testRoot);
		// Should still work — config is optional
		expect(result).toHaveProperty("project");
	});

	// --- Negative: not a git repo ---
	it("rejects invalid input: handles non-git directory", async () => {
		const nonGitDir = "/tmp/gwrk-test-non-git";
		fs.mkdirSync(nonGitDir, { recursive: true });

		try {
			const result = await discoverProject(nonGitDir);
			// git fields should be 'unknown' or falsy, not crash
			expect(result.git.branch === "unknown" || !result.git.branch).toBe(true);
		} finally {
			fs.rmSync(nonGitDir, { recursive: true, force: true });
		}
	});

	// --- Contract: config.agents detection ---
	it("detects available agents from PATH", async () => {
		const result = await discoverProject(testRoot);

		expect(result.config).toHaveProperty("agents");
		expect(Array.isArray(result.config.agents)).toBe(true);
		// At least one agent should be detectable on this machine
	});
});
