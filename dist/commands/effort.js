import path from "node:path";
import { Command } from "commander";
import { computeEffort } from "../engine/effort.js";
import { writeEffortReport } from "../engine/report-writer.js";
import { resolveRoleMultipliers } from "../engine/roles.js";
import { extractStories } from "../engine/spec-parser.js";
import { loadConfig } from "../utils/config.js";
export const effortCommand = new Command("effort")
    .description("Calculate deterministic effort estimation from spec stories")
    .argument("<feature>", "The feature directory under specs/ (e.g. 001-cli-core)")
    .option("--json", "Output structured JSON report to stdout")
    .action((feature, options) => {
    try {
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", feature);
        const config = loadConfig(projectRoot);
        const roleMultipliers = resolveRoleMultipliers(config);
        const stories = extractStories(featureDir);
        const report = computeEffort(stories, roleMultipliers, 1.25);
        report.featureId = feature;
        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        }
        else {
            const outDir = path.join(projectRoot, "docs", "assessments");
            const filePath = writeEffortReport(report, outDir);
            console.log(`Effort report generated at: ${path.relative(projectRoot, filePath)}`);
        }
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
});
