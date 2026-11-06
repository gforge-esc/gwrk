/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { detectProfile } from "../engine/profile-detector.js";
import {
  isPolyglotSourceFile,
  isPolyglotTestFile,
} from "../ports/toolchain-port.js";
import { extractFilePaths } from "../utils/file-extract.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";
import { loadTaskState } from "../utils/state.js";
import {
  discoverTestsForSources,
  listTestsTree,
} from "../utils/test-discovery.js";
import { getTestCommand, getTestExtension } from "../utils/toolchain-mapper.js";

/**
 * gwrk test — Run the project's test runner scoped to a feature or phase's test files.
 *
 * Reads tasks.json to discover test files referenced by the feature's tasks,
 * resolves co-located and tests/ tree test files using the detected project profile,
 * and invokes the configured polyglot test harness (Vitest, Pytest, Go test, Cargo test).
 */
export const testCommand = new Command("test")
  .description("Run the project test suite scoped to feature test files")
  .addHelpText(
    "after",
    `
Type: query
Mutates: none
Format: use gwrk --format json for structured output
Exit codes:
  0: All tests pass
  1: One or more tests failed, or no test files found
  2: Usage error

Examples:
  gwrk test 001
  gwrk test 001 1
  gwrk test 013-agent-native-interface
`,
  )
  .argument("<feature>", "Feature ID or prefix (e.g. '001' or '001-cli-core')")
  .argument("[phase]", "Optional phase number (e.g. '1' or '01')")
  .option("-p, --phase <phase>", "Scope to a specific phase")
  .action(
    async (
      featureInput: string,
      phaseArg: string | undefined,
      opts: { phase?: string },
    ) => {
      await withSignal("test", async () => {
        const phase = phaseArg || opts?.phase;
        const cwd = process.cwd();
        const feature = resolveFeature(featureInput, cwd);
        const specDir = path.join(cwd, "specs", feature);

        let taskState: ReturnType<typeof loadTaskState>;
        try {
          taskState = loadTaskState(specDir);
        } catch {
          throw new CommandError(
            `No tasks.json found for ${feature}. Run 'gwrk define tasks ${feature}' first.`,
            1,
          );
        }

        const phases = phase
          ? taskState.phases.filter(
              (p) => p.id === `phase-${phase.padStart(2, "0")}`,
            )
          : taskState.phases;

        if (phases.length === 0) {
          throw new CommandError(`Phase ${phase} not found in ${feature}.`, 1);
        }

        const profile = await detectProfile(cwd);
        const testExt = getTestExtension(profile);

        const mentionedTests: string[] = [];
        const sourceFiles: string[] = [];
        const declaredTargets: string[] = [];

        for (const p of phases) {
          if (p.testTargets) {
            declaredTargets.push(...p.testTargets);
          }
          for (const task of p.tasks) {
            const paths = extractFilePaths(
              `${task.title} ${task.description ?? ""}`,
            );
            for (const f of paths) {
              if (isPolyglotTestFile(f, testExt)) {
                mentionedTests.push(f);
              } else if (isPolyglotSourceFile(f, testExt)) {
                sourceFiles.push(f);
              }
            }
          }
        }

        const discovered = discoverTestsForSources({
          sourceFiles,
          mentionedTests,
          testExt,
          fileExists: (rel) => fs.existsSync(path.join(cwd, rel)),
          testsTreeFiles: listTestsTree(cwd),
          declaredTargets,
        });

        if (discovered.length === 0) {
          console.log(
            `  No tests found for ${feature}${phase ? ` phase ${phase}` : ""}.`,
          );
          blocked(
            `No test files found for ${feature}${phase ? ` phase ${phase}` : ""}`,
          );
          throw new CommandError(
            `No test files found for ${feature}. Run 'gwrk define tests ${feature}' first.`,
            1,
          );
        }

        const cmd =
          getTestCommand(profile, discovered) ??
          `pnpm vitest run ${discovered.join(" ")}`;

        banner("test", {
          Feature: feature,
          Phase: phase ? `phase-${phase.padStart(2, "0")}` : "all",
          Files: `${discovered.length} test file(s)`,
        });

        for (const tf of discovered) {
          console.log(`    • ${tf}`);
        }
        console.log("");

        const startTime = Date.now();
        try {
          execSync(cmd, {
            cwd,
            stdio: "inherit",
          });
          const durationS = Math.round((Date.now() - startTime) / 1000);
          success("test", durationS);
        } catch {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          fail("test", 1, durationS);
          throw new CommandError("Tests failed", 1);
        }
      });
    },
  );
