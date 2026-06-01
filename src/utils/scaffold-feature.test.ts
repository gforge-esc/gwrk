import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	generateSlug,
	getHighestFromSpecs,
	getNextFeatureNumber,
	scaffoldFeature,
} from "./scaffold-feature.js";

// Mock DB access — scaffolding should work without a DB
vi.mock("../db/index.js", () => ({
	getDb: vi.fn(() => {
		throw new Error("DB not available in test");
	}),
}));

vi.mock("../db/plan.js", () => ({
	insertFeature: vi.fn(),
}));

describe("generateSlug", () => {
	it("extracts 3 meaningful words from description", () => {
		expect(generateSlug("Add user authentication system")).toBe(
			"user-authentication-system",
		);
	});

	it("filters stop words", () => {
		expect(generateSlug("Add a new CLI command for the project")).toBe(
			"new-cli-command-project",
		);
	});

	it("keeps 4 words when exactly 4 meaningful words", () => {
		expect(generateSlug("Ontology Integration Layer Design")).toBe(
			"ontology-integration-layer-design",
		);
	});

	it("limits to 3 words when more than 4 meaningful words", () => {
		expect(
			generateSlug("OAuth2 Integration Provider Factory Registry"),
		).toBe("oauth2-integration-provider");
	});

	it("handles short descriptions", () => {
		expect(generateSlug("Ontology Integration")).toBe(
			"ontology-integration",
		);
	});

	it("preserves acronyms shorter than 3 chars", () => {
		// "AI" appears as uppercase in the original description — kept even though < 3 chars
		expect(generateSlug("AI Scoring Implementation")).toBe(
			"ai-scoring-implementation",
		);
	});

	it("handles descriptions with special characters", () => {
		expect(generateSlug("RBAC & User Management")).toBe(
			"rbac-user-management",
		);
	});

	it("falls back to kebab-case when all words are stop words", () => {
		expect(generateSlug("do the is")).toBe("do-the-is");
	});
});

describe("getHighestFromSpecs", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns 0 for empty specs directory", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);
		expect(getHighestFromSpecs(specsDir)).toBe(0);
	});

	it("returns 0 for nonexistent specs directory", () => {
		expect(getHighestFromSpecs(path.join(tempDir, "nope"))).toBe(0);
	});

	it("finds highest number from directories", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);
		fs.mkdirSync(path.join(specsDir, "001-first"));
		fs.mkdirSync(path.join(specsDir, "010-tenth"));
		fs.mkdirSync(path.join(specsDir, "046-latest"));
		fs.mkdirSync(path.join(specsDir, "feat-no-number"));
		expect(getHighestFromSpecs(specsDir)).toBe(46);
	});

	it("handles gaps in numbering", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);
		fs.mkdirSync(path.join(specsDir, "001-first"));
		fs.mkdirSync(path.join(specsDir, "050-jumped"));
		expect(getHighestFromSpecs(specsDir)).toBe(50);
	});
});

describe("getNextFeatureNumber", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns 1 for empty specs", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);
		expect(getNextFeatureNumber(specsDir)).toBe(1);
	});

	it("returns max + 1", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);
		fs.mkdirSync(path.join(specsDir, "046-latest"));
		expect(getNextFeatureNumber(specsDir)).toBe(47);
	});
});

describe("scaffoldFeature", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("creates feature directory with auto-number and slug", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);
		fs.mkdirSync(path.join(specsDir, "046-intent-guidance"));

		const result = scaffoldFeature(specsDir, "Ontology Integration");

		expect(result.featureId).toBe("047-ontology-integration");
		expect(result.featureNum).toBe("047");
		expect(fs.existsSync(result.specDir)).toBe(true);
	});

	it("creates specs/ directory if it does not exist", () => {
		const specsDir = path.join(tempDir, "specs");

		const result = scaffoldFeature(specsDir, "First Feature");

		expect(result.featureNum).toBe("001");
		expect(fs.existsSync(specsDir)).toBe(true);
		expect(fs.existsSync(result.specDir)).toBe(true);
	});

	it("copies spec template when available", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);

		// Create template
		const templateDir = path.join(tempDir, ".specify", "templates");
		fs.mkdirSync(templateDir, { recursive: true });
		fs.writeFileSync(
			path.join(templateDir, "spec-template.md"),
			"# Template",
		);

		const result = scaffoldFeature(specsDir, "Test Feature");

		const specFile = path.join(result.specDir, "spec.md");
		expect(fs.existsSync(specFile)).toBe(true);
		expect(fs.readFileSync(specFile, "utf-8")).toBe("# Template");
	});

	it("uses explicit short name when provided", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);

		const result = scaffoldFeature(specsDir, "Some Long Description", {
			shortName: "custom-slug",
		});

		expect(result.featureId).toBe("001-custom-slug");
	});

	it("uses explicit number when provided", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);

		const result = scaffoldFeature(specsDir, "Test Feature", {
			number: 99,
		});

		expect(result.featureId).toBe("099-test-feature");
	});

	it("does not throw when DB is unavailable", () => {
		const specsDir = path.join(tempDir, "specs");
		fs.mkdirSync(specsDir);

		// DB registration is non-fatal — should not throw even when DB mocks fail
		expect(() => scaffoldFeature(specsDir, "DB Registration Test")).not.toThrow();
		// "DB" is an acronym (uppercase in original), so it's kept
		expect(fs.existsSync(path.join(specsDir, "001-db-registration-test"))).toBe(true);
	});
});
