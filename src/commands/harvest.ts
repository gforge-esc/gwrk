import path from "node:path";
import { Command } from "commander";
import { harvestFeature } from "../engine/harvest.js";
import type { HarvestRecord } from "../engine/types.js";
import { withSignal } from "../utils/signal.js";

/**
 * gwrk harvest <feature> [phase]
 *
 * Manual trigger for the harvest pipeline.
 * (FR-H01, FR-H03, FR-H04, FR-H05, FR-H06, FR-H07, FR-H08)
 */
export const harvestCommand = new Command("harvest")
  .description("Manually trigger the post-merge harvest pipeline")
  .argument("<feature>", "Feature ID (e.g. 011-harvest)")
  .argument("[phase]", "Phase ID (e.g. phase-01 or 1)")
  .option("--pr <number>", "PR number", Number.parseInt)
  .option("--commit <sha>", "Merge commit SHA")
  .action(async (feature, phase, options) => {
    await withSignal(`harvest ${feature}`, async () => {
      const projectRoot = process.cwd();

      // Format phase uniformly to phase-0X if it's just a number
      let phaseId = phase;
      if (phase?.match(/^\d+$/)) {
        phaseId = `phase-${phase.padStart(2, "0")}`;
      }

      const record: HarvestRecord = {
        featureId: feature,
        phaseId,
        prNumber: options.pr || 0,
        prUrl: "",
        mergeCommitSha: options.commit || "manual",
        mergedAt: new Date().toISOString(),
        mergedBy: "manual",
        status: "merged",
      };

      console.log(
        `Manually triggering harvest for ${feature}${phaseId ? ` (${phaseId})` : ""}...`,
      );
      await harvestFeature(projectRoot, record);
      console.log("Harvest complete.");
    });
  });
