/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import { Command } from "commander";
import { logCliOutput } from "../adapters/cli/output-scope.js";
import { harvestFeature } from "../engine/harvest.js";
import type { HarvestRecord } from "../engine/types.js";
import { isRemote } from "../utils/device.js";
import { detectDefaultBranch, syncTrunkForHarvest } from "../utils/git.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * gwrk harvest <feature> [phase]
 *
 * Manual trigger for the harvest pipeline.
 * (FR-H01, FR-H03, FR-H04, FR-H05, FR-H06, FR-H07, FR-H08)
 */
export const createHarvestCommand = () =>
  new Command("harvest")
    .description("Manually trigger the post-merge harvest pipeline")
    .addHelpText(
      "after",
      `
Examples:
  gwrk harvest 001
  gwrk harvest 001-cli-core 1 --pr 42
`,
    )
    .argument("<feature>", "Feature ID (e.g. 011-harvest)")
    .argument("[phase]", "Phase ID (e.g. phase-01 or 1)")
    .option("--pr <number>", "PR number", Number.parseInt)
    .option("--commit <sha>", "Merge commit SHA")
    .action(async (featureArg, phase, options) => {
      await withSignal(`harvest ${featureArg}`, async () => {
        if (isRemote()) {
          throw new CommandError(
            "This machine is registered as a remote device. Harvest runs on the server only.\n" +
              "To change this machine's role: gwrk init --server",
            1,
          );
        }

        const projectRoot = process.cwd();
        const baseBranch = detectDefaultBranch(projectRoot, "develop");
        syncTrunkForHarvest(projectRoot, baseBranch);
        const feature = resolveFeature(featureArg, projectRoot);

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

        logCliOutput(
          `Manually triggering harvest for ${feature}${phaseId ? ` (${phaseId})` : ""}...`,
        );
        await harvestFeature(projectRoot, record);
        logCliOutput("Harvest complete.");
      });
    });

export const harvestCommand = createHarvestCommand();
