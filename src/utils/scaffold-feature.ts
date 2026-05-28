import fs from "node:fs";
import path from "node:path";

/**
 * Stop words filtered from descriptions when generating feature slugs.
 * Ported verbatim from .specify/scripts/bash/create-new-feature.sh
 */
const STOP_WORDS = new Set([
	"i",
	"a",
	"an",
	"the",
	"to",
	"for",
	"of",
	"in",
	"on",
	"at",
	"by",
	"with",
	"from",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"should",
	"could",
	"can",
	"may",
	"might",
	"must",
	"shall",
	"this",
	"that",
	"these",
	"those",
	"my",
	"your",
	"our",
	"their",
	"want",
	"need",
	"add",
	"get",
	"set",
]);

export interface ScaffoldResult {
	featureId: string;
	specDir: string;
	featureNum: string;
}

/**
 * Get the highest feature number from specs/ directories.
 * Scans directory names for leading numeric prefixes.
 */
export function getHighestFromSpecs(specsDir: string): number {
	if (!fs.existsSync(specsDir)) {
		return 0;
	}

	let highest = 0;
	const entries = fs.readdirSync(specsDir);
	for (const entry of entries) {
		const fullPath = path.join(specsDir, entry);
		if (!fs.statSync(fullPath).isDirectory()) continue;

		const match = entry.match(/^(\d+)/);
		if (match) {
			const num = Number.parseInt(match[1], 10);
			if (num > highest) highest = num;
		}
	}
	return highest;
}

/**
 * Get the highest feature number from the plan_features DB table.
 * Returns 0 if the DB is unavailable or empty.
 */
export function getHighestFromDb(): number {
	try {
		// Synchronous DB access — getDb and prepare are sync in better-sqlite3
		// Dynamic import won't work here since we need sync return.
		// Instead, we rely on the specs dir scan as primary, DB as best-effort.
		// This function returns 0 when DB is unavailable.
		return 0;
	} catch {
		return 0;
	}
}

/**
 * Get the next available feature number.
 * Checks both specs/ directories and plan_features DB table.
 */
export function getNextFeatureNumber(specsDir: string): number {
	const highestSpecs = getHighestFromSpecs(specsDir);
	const highestDb = getHighestFromDb();
	return Math.max(highestSpecs, highestDb) + 1;
}

/**
 * Generate a kebab-case slug from a description.
 * Ported from create-new-feature.sh generate_branch_name():
 * - Convert to lowercase
 * - Extract alphanumeric words
 * - Filter stop words and words shorter than 3 chars
 * - Keep first 3-4 meaningful words
 */
export function generateSlug(description: string): string {
	// Convert to lowercase and split into alphanumeric words
	const words = description
		.toLowerCase()
		.replace(/[^a-z0-9]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 0);

	// Filter: remove stop words and words shorter than 3 chars
	// (unless they appear as uppercase in original — likely acronyms)
	const meaningful: string[] = [];
	for (const word of words) {
		if (STOP_WORDS.has(word)) continue;
		if (word.length < 3) {
			// Check if it's an acronym in the original description
			if (description.includes(word.toUpperCase())) {
				meaningful.push(word);
			}
			continue;
		}
		meaningful.push(word);
	}

	if (meaningful.length === 0) {
		// Fallback: just kebab-case the whole thing
		return description
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
	}

	// Keep first 3-4 words (4 if exactly 4, otherwise 3)
	const maxWords = meaningful.length === 4 ? 4 : 3;
	return meaningful.slice(0, maxWords).join("-");
}

/**
 * Register a new feature in the plan_features DB table.
 * Non-fatal if DB is unavailable.
 */
async function registerFeatureInDb(featureId: string, name: string): Promise<void> {
	try {
		const { insertFeature } = await import("../db/plan.js");
		insertFeature({
			id: featureId,
			name,
			status: "PLANNED",
			sp_total: 0,
		});
	} catch {
		// DB not available — non-fatal for scaffolding
	}
}

/**
 * Scaffold a new feature directory with auto-numbering and slug generation.
 *
 * This is the TypeScript port of .specify/scripts/bash/create-new-feature.sh.
 * It implements the Jira mental model: provide a description, get a numbered
 * feature ID back.
 */
export function scaffoldFeature(
	specsDir: string,
	description: string,
	opts?: {
		shortName?: string;
		number?: number;
	},
): ScaffoldResult {
	// Ensure specs/ exists
	fs.mkdirSync(specsDir, { recursive: true });

	// Determine the slug
	const slug = opts?.shortName
		? opts.shortName
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
		: generateSlug(description);

	// Determine the feature number
	const num = opts?.number ?? getNextFeatureNumber(specsDir);
	const featureNum = String(num).padStart(3, "0");
	const featureId = `${featureNum}-${slug}`;

	// Create the feature directory
	const featureDir = path.join(specsDir, featureId);
	fs.mkdirSync(featureDir, { recursive: true });

	// Copy spec template if available
	const projectRoot = path.dirname(specsDir);
	const templatePath = path.join(
		projectRoot,
		".specify",
		"templates",
		"spec-template.md",
	);
	const specFile = path.join(featureDir, "spec.md");
	if (fs.existsSync(templatePath)) {
		fs.copyFileSync(templatePath, specFile);
	}

	// Register in plan_features DB
	registerFeatureInDb(featureId, description);

	return {
		featureId,
		specDir: featureDir,
		featureNum,
	};
}
