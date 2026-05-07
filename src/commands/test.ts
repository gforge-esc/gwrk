import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { banner, fail, success } from "../utils/format.js";
import { loadTaskState } from "../utils/state.js";

import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * gwrk test <feature> [--phase <N>]
 *
 * Runs vitest scoped to the test files of a feature or phase.
 */
export const testCommand = new Command("test")
  .description("Run vitest scoped to feature test files")
  .argument("<feature>", "Feature ID (e.g. 001-cli-core)")
  .option("-p, --phase <n>", "Phase number")
  .action(async (featureInput: string, options: { phase?: string }) => {
    await withSignal("test", async () => {
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureInput, projectRoot);
      const featureDir = path.join(projectRoot, "specs", feature);

      if (!fs.existsSync(featureDir)) {
        throw new CommandError(`Feature directory not found: ${featureDir}`, 1);
      }

      const startTime = Date.now();
      banner("test", { Feature: feature, Phase: options.phase ?? "all" });

      try {
        const taskState = loadTaskState(featureDir);
        const testFiles = new Set<string>();

        for (const phase of taskState.phases) {
          if (
            options.phase &&
            phase.id !== `phase-${options.phase.padStart(2, "0")}`
          ) {
            continue;
          }

          for (const task of phase.tasks) {
            const text = `${task.title} ${task.description ?? ""}`;
            const matches = text.matchAll(
              /(?:src|tests|docs|scripts|packages)\/[^\s),]+/g,
            );
            for (const match of matches) {
              const f = match[0].replace(/[,;.]$/, "");
              if (f.includes(".test.ts") || f.includes(".test.js")) {
                testFiles.add(f);
              } else if (
                (f.endsWith(".ts") || f.endsWith(".js")) &&
                !f.includes(".test.")
              ) {
                const testFile = f.replace(/\.(ts|js)$/, ".test.$1");
                if (fs.existsSync(path.join(projectRoot, testFile))) {
                  testFiles.add(testFile);
                }
              }
            }
          }
        }

        if (testFiles.size === 0) {
          console.log("  No tests found for this feature/phase.");
          const durationS = Math.round((Date.now() - startTime) / 1000);
          success("test", durationS);
          return;
        }

        const testFilesArray = Array.from(testFiles);
        console.log(`  Found ${testFilesArray.length} test files`);

        execSync(`pnpm vitest run ${testFilesArray.join(" ")}`, {
          cwd: projectRoot,
          stdio: "inherit",
        });

        const durationS = Math.round((Date.now() - startTime) / 1000);
        success("test", durationS);
      } catch (error) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const exitCode =
          error instanceof Error && "status" in error
            ? (error as { status: number }).status
            : 1;
        fail("test", exitCode, durationS);
        process.exitCode = exitCode || 1;
      }
    });
  });
