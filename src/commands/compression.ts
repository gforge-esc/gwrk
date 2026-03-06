import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { gatherDeliveryActuals, computeCompression, generateSummary } from "../engine/compression.js";
import { extractStories } from "../engine/spec-parser.js";
import { resolveRoleMultipliers } from "../engine/roles.js";
import { computeEffort } from "../engine/effort.js";
import { loadConfig } from "../utils/config.js";
import type { CompressionReport } from "../engine/types.js";

function getEffortReport(featureDir: string, featureId: string, projectRoot: string) {
  const config = loadConfig(projectRoot);
  const roleMultipliers = resolveRoleMultipliers(config);
  const stories = extractStories(featureDir);
  const report = computeEffort(stories, roleMultipliers, 1.25);
  report.featureId = featureId;
  return report;
}

export const compressionCommand = new Command("compression")
  .description("Calculate development compression ratios")
  .argument("[feature]", "The feature directory under specs/ to calculate. Omit if --all flag is used.")
  .option("--all", "Generate summary for all shipped features under specs/")
  .option("--json", "Output structured JSON to stdout")
  .action((feature, options) => {
    try {
      const projectRoot = process.cwd();

      if (options.all) {
        const specsDir = path.join(projectRoot, "specs");
        if (!fs.existsSync(specsDir)) {
          throw new Error("specs directory not found");
        }
        
        const directories = fs.readdirSync(specsDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory() && dirent.name.match(/^\d{3}-/))
          .map(dirent => dirent.name);

        const reports: CompressionReport[] = [];
        
        for (const feat of directories) {
          try {
            const featDir = path.join(specsDir, feat);
            
            // Generate Effort Forecast dynamically
            const effort = getEffortReport(featDir, feat, projectRoot);
            const actuals = gatherDeliveryActuals(featDir);
            
            const forecast = {
              totalSP: effort.totalSP,
              roles: effort.roles.map(r => ({ role: r.role, sp: r.spAssigned })),
              estimatedHours: effort.totalWithOverhead,
              estimatedDays: effort.totalDays,
            };
            
            const ratios = computeCompression(forecast, actuals);
            
            reports.push({
              featureId: feat,
              generatedAt: new Date().toISOString(),
              forecast,
              actuals,
              compression: ratios,
            });
          } catch (e) {
            // Ignore features that might not be shipped yet or missing spec
          }
        }

        const summary = generateSummary(reports);
        
        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          console.log(`\n=== COMPRESSION SUMMARY ===\n`);
          console.log(`Total SP Delivered: ${summary.totals.totalSP}`);
          console.log(`Avg Point Compression: ${summary.totals.avgPointCompression.toFixed(2)}x`);
          console.log(`Avg Total Compression: ${summary.totals.avgTotalCompression.toFixed(2)}x`);
          console.log(`Trend: ${summary.trend.toUpperCase()}\n`);
          
          if (summary.best.featureId) {
            console.log(`Best: ${summary.best.featureId} (${summary.best.pointCompression.toFixed(2)}x)`);
            console.log(`Worst: ${summary.worst.featureId} (${summary.worst.pointCompression.toFixed(2)}x)\n`);
          }

          console.log(`  Feature                 | SP | Point Comp | Total Comp`);
          console.log(`  ------------------------|----|------------|-----------`);
          for (const feat of summary.features) {
            const name = feat.featureId.padEnd(23);
            const sp = feat.forecast.totalSP.toString().padStart(2);
            const pc = feat.compression.pointCompression.toFixed(1).padStart(10);
            const tc = feat.compression.totalCompression.toFixed(1).padStart(10);
            console.log(`  ${name} | ${sp} | ${pc} | ${tc}`);
          }
        }
      } else {
        if (!feature) {
          throw new Error("Must specify a feature OR use --all");
        }

        const featureDir = path.join(projectRoot, "specs", feature);
        const effort = getEffortReport(featureDir, feature, projectRoot);
        const actuals = gatherDeliveryActuals(featureDir);
        
        const forecast = {
          totalSP: effort.totalSP,
          roles: effort.roles.map(r => ({ role: r.role, sp: r.spAssigned })),
          estimatedHours: effort.totalWithOverhead,
          estimatedDays: effort.totalDays,
        };
        
        const ratios = computeCompression(forecast, actuals);
        
        const report: CompressionReport = {
          featureId: feature,
          generatedAt: new Date().toISOString(),
          forecast,
          actuals,
          compression: ratios,
        };

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`\n=== COMPRESSION REPORT: ${feature} ===\n`);
          console.log(`Point Compression: ${ratios.pointCompression.toFixed(2)}x`);
          console.log(`Total Compression: ${ratios.totalCompression.toFixed(2)}x`);
          console.log(`Dormancy:          ${ratios.dormancyDays} days`);
          console.log(`Coding Time:       ${(actuals.activeCodingMinutes/60).toFixed(2)} hours`);
          console.log(`Elapsed Window:    ${actuals.deliveryWindowHours.toFixed(2)} hours`);
        }
      }
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
