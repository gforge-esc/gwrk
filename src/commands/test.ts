/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { banner, fail, success } from "../utils/format.js";
import { loadTaskState } from "../utils/state.js";

import { resolveFeature } from "../utils/resolve-feature.js";
import { detectProfile } from "../engine/profile-detector.js";
import { getTestExtension } from "../utils/toolchain-mapper.js";
import { extractFilePaths } from "../utils/file-extract.js";
import { discoverTestsForSources, listTestsTree } from "../utils/test-discovery.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * gwrk test <feature> [--phase <N>]
 *
 * Runs vitest scoped to the test files of a feature or phase.
 */
export const testCommand = new Command("test")
  .description("Run vitest scoped to feature test files")
  .addHelpText(
    "after",
    `
Examples:
  gwrk test 001
  gwrk test 001-cli-core --phase 1
`,
  )
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
        const profile = await detectProfile(projectRoot);
        const testExt = getTestExtension(profile);
        const mentionedTests: string[] = [];
        const sourceFiles: string[] = [];

        for (const phase of taskState.phases) {
          if (
            options.phase &&
            phase.id !== `phase-${options.phase.padStart(2, "0")}`
          ) {
            continue;
          }

          for (const task of phase.tasks) {
            for (const f of extractFilePaths(
              `${task.title} ${task.description ?? ""}`,
            )) {
              if (f.includes(".test.")) mentionedTests.push(f);
              else if (f.endsWith(".ts") || f.endsWith(".js"))
                sourceFiles.push(f);
            }
          }
        }

        // Same discovery the ship gate uses: mentioned + co-located + tests/ tree.
        const testFiles = new Set(
          discoverTestsForSources({
            sourceFiles,
            mentionedTests,
            testExt,
            fileExists: (rel) => fs.existsSync(path.join(projectRoot, rel)),
            testsTreeFiles: listTestsTree(projectRoot),
          }),
        );

        if (testFiles.size === 0) {
          // FR-009 / liveness (ADR-005 §10): nothing verified is NOT success.
          console.log("  ✗ No tests found for this feature/phase.");
          const durationS = Math.round((Date.now() - startTime) / 1000);
          fail("test", 1, durationS);
          process.exitCode = 1;
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
