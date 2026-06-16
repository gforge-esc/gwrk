/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  computeCompression,
  computeForecastFromLOC,
  gatherDeliveryActuals,
  generateSummary,
} from "../engine/compression.js";
import { computeLeadingIndicators } from "../engine/indicators.js";
import { computeEffort } from "../engine/effort.js";
import { resolveRoleMultipliers } from "../engine/roles.js";
import { extractStories } from "../engine/spec-parser.js";
import type { CompressionReport } from "../engine/types.js";
import { loadConfig } from "../utils/config.js";
import { resolveProjectId } from "../utils/project-id.js";
import { recordCompression } from "../db/compression.js";

function getEffortReport(
  featureDir: string,
  featureId: string,
  projectRoot: string,
) {
  const config = loadConfig(projectRoot);
  const roleMultipliers = resolveRoleMultipliers(config);
  const stories = extractStories(featureDir);
  const report = computeEffort(stories, roleMultipliers, 1.25);
  report.featureId = featureId;
  return report;
}

import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const compressionCommand = new Command("compression")
  .description("Calculate development compression ratios")
  .addHelpText(
    "after",
    `
Examples:
  gwrk measure compression 001
  gwrk measure compression 001-cli-core --json
  gwrk measure compression --all
`,
  )
  .argument(
    "[feature]",
    "The feature directory under specs/ to calculate. Omit if --all flag is used.",
  )
  .option("--all", "Generate summary for all shipped features under specs/")
  .option("--json", "Output structured JSON to stdout")
  .action(async (featureArg, options) => {
    await withSignal("compression", async () => {
      const projectRoot = process.cwd();

      if (options.all) {
        const specsDir = path.join(projectRoot, "specs");
        if (!fs.existsSync(specsDir)) {
          throw new CommandError("specs directory not found", 1);
        }

        const directories = fs
          .readdirSync(specsDir, { withFileTypes: true })
          .filter(
            (dirent) => dirent.isDirectory() && dirent.name.match(/^\d{3}-/),
          )
          .map((dirent) => dirent.name);

        const reports: CompressionReport[] = [];

        for (const feat of directories) {
          try {
            const featDir = path.join(specsDir, feat);

            // Generate Effort Forecast dynamically
            const effort = getEffortReport(featDir, feat, projectRoot);
            const actuals = gatherDeliveryActuals(featDir);

            // FR-016: LOC-derived SP fallback when spec has no explicit SP
            const forecast = effort.totalSP > 0
              ? {
                  totalSP: effort.totalSP,
                  roles: effort.roles.map((r) => ({
                    role: r.role,
                    sp: r.spAssigned,
                  })),
                  estimatedHours: effort.totalWithOverhead,
                  estimatedDays: effort.totalDays,
                }
              : computeForecastFromLOC(featDir);

            const ratios = computeCompression(forecast, actuals);
            const projectId = resolveProjectId(projectRoot);
            const indicators = computeLeadingIndicators(
              feat,
              forecast,
              projectId,
            );

            const report: CompressionReport = {
              featureId: feat,
              generatedAt: new Date().toISOString(),
              forecast,
              actuals,
              compression: ratios,
              indicators,
            };

            reports.push(report);
            try {
              recordCompression(report, projectId);
            } catch (err) {
              // Ignore persistence errors in bulk run
            }
          } catch (e) {
            // Ignore features that might not be shipped yet or missing spec
          }
        }

        const summary = generateSummary(reports);

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log("\n=== COMPRESSION SUMMARY ===\n");
          console.log(`Total SP Delivered: ${summary.totals.totalSP}`);
          console.log(
            `Avg Point Compression: ${summary.totals.avgPointCompression.toFixed(2)}x`,
          );
          console.log(
            `Avg Total Compression: ${summary.totals.avgTotalCompression.toFixed(2)}x`,
          );

          console.log("\n--- Avg Leading Indicators ---");
          console.log(
            `Convergence:  ${summary.totals.avgFirstPassRate?.toFixed(1)}% first-pass, (Avg Attempts): ${summary.totals.avgAvgAttempts?.toFixed(2)}`,
          );
          console.log(
            `Density:      ${summary.totals.avgLinesPerSP?.toFixed(1)} lines/SP, ${summary.totals.avgFilesPerSP?.toFixed(1)} files/SP, ${summary.totals.avgToolCallsPerSP?.toFixed(1)} tools/SP`,
          );
          console.log(
            `Spec Quality: ${summary.totals.totalContracts} total contracts, ${summary.totals.totalGates} total gates`,
          );

          console.log(`\nTrend: ${summary.trend.toUpperCase()}\n`);

          if (summary.best.featureId) {
            console.log(
              `Best: ${summary.best.featureId} (${summary.best.pointCompression.toFixed(2)}x)`,
            );
            console.log(
              `Worst: ${summary.worst.featureId} (${summary.worst.pointCompression.toFixed(2)}x)\n`,
            );
          }

          console.log(
            "  Feature                 | SP | Point Comp | Total Comp",
          );
          console.log(
            "  ------------------------|----|------------|-----------",
          );
          for (const feat of summary.features) {
            const name = feat.featureId.padEnd(23);
            const sp = feat.forecast.totalSP.toString().padStart(2);
            const pc = feat.compression.pointCompression
              .toFixed(1)
              .padStart(10);
            const tc = feat.compression.totalCompression
              .toFixed(1)
              .padStart(10);
            console.log(`  ${name} | ${sp} | ${pc} | ${tc}`);
          }
        }
      } else {
        if (!featureArg) {
          throw new CommandError(
            "Must specify a feature OR use --all. Run 'gwrk project specs' to list features.",
            2,
          );
        }

        const feature = resolveFeature(featureArg, projectRoot);
        const featureDir = path.join(projectRoot, "specs", feature);
        if (!fs.existsSync(featureDir)) {
          throw new CommandError(
            `Feature directory not found: ${featureDir}. Run 'gwrk project specs' to list available features.`,
            1,
          );
        }
        const effort = getEffortReport(featureDir, feature, projectRoot);
        const actuals = gatherDeliveryActuals(featureDir);

        // FR-016: LOC-derived SP fallback when spec has no explicit SP
        const forecast = effort.totalSP > 0
          ? {
              totalSP: effort.totalSP,
              roles: effort.roles.map((r) => ({ role: r.role, sp: r.spAssigned })),
              estimatedHours: effort.totalWithOverhead,
              estimatedDays: effort.totalDays,
            }
          : computeForecastFromLOC(featureDir);

        const ratios = computeCompression(forecast, actuals);
        const projectId = resolveProjectId(projectRoot);
        const indicators = computeLeadingIndicators(feature, forecast, projectId);

        const report: CompressionReport = {
          featureId: feature,
          generatedAt: new Date().toISOString(),
          forecast,
          actuals,
          compression: ratios,
          indicators,
        };

        try {
          recordCompression(report, projectId);
        } catch (err) {
          // Non-fatal persistence error
        }

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`\n=== COMPRESSION REPORT: ${feature} ===\n`);
          console.log(
            `Point Compression: ${ratios.pointCompression.toFixed(2)}x`,
          );
          console.log(
            `Total Compression: ${ratios.totalCompression.toFixed(2)}x`,
          );
          console.log(`Dormancy:          ${ratios.dormancyDays} days`);
          console.log(
            `Coding Time:       ${(actuals.activeCodingMinutes / 60).toFixed(2)} hours`,
          );
          console.log(
            `Elapsed Window:    ${actuals.deliveryWindowHours.toFixed(2)} hours`,
          );

          if (indicators) {
            console.log("\n--- Leading Indicators ---");
            console.log(
              `Convergence:       ${indicators.convergence.firstPassRate}% first-pass, (Avg Attempts): ${indicators.convergence.avgAttempts}`,
            );
            console.log(
              `Density:           ${indicators.density.linesPerSP} lines/SP, ${indicators.density.filesPerSP} files/SP, ${indicators.density.toolCallsPerSP} tools/SP`,
            );
            console.log(
              `Spec Quality:      ${indicators.specQuality.contractCount} contracts, ${indicators.specQuality.gateCount} gates`,
            );
          }
        }
      }
    });
  });
