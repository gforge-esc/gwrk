import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { runGate } from "../utils/exec.js";
import { resolveFormat } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";
import { loadTaskState } from "../utils/state.js";
import { banner, color, success, fail } from "../utils/format.js";

/**
 * GateCheckResult schema (DM-002)
 */
export interface GateCheckResult {
  taskId: string;
  feature: string;
  gatePath: string;
  result: "PASS" | "FAIL" | "SKIPPED";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Executes a gate script and returns the result.
 */
export async function runGateCheck(
  taskId: string,
  feature: string,
): Promise<GateCheckResult> {
  const projectRoot = process.cwd();
  // Strip specs/ prefix if present to avoid double prefixing
  const normalizedFeature = feature.startsWith("specs/")
    ? feature.replace("specs/", "")
    : feature;

  const gatePath = path.join(
    "specs",
    normalizedFeature,
    "gates",
    `${taskId}-gate.sh`,
  );
  const absoluteGatePath = path.join(projectRoot, gatePath);

  if (!fs.existsSync(absoluteGatePath)) {
    throw new CommandError(
      `Gate script not found: ${gatePath}. Run 'gwrk project gates' to list available gates.`,
      1,
    );
  }

  const start = performance.now();
  const result = runGate(absoluteGatePath);
  const durationMs = Math.round(performance.now() - start);

  return {
    taskId,
    feature: normalizedFeature,
    gatePath,
    result: result.exitCode === 0 ? "PASS" : "FAIL",
    exitCode: result.exitCode,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    durationMs,
  };
}

/**
 * Infers feature directory from taskId by searching for the gate script.
 */
export function inferFeatureFromTaskId(taskId: string): string {
  const projectRoot = process.cwd();
  const specsDir = path.join(projectRoot, "specs");

  if (!fs.existsSync(specsDir)) {
    throw new CommandError(
      "Feature required. Run 'gwrk project specs' to list features.",
      2,
    );
  }

  const matches: string[] = [];
  const features = fs
    .readdirSync(specsDir)
    .filter((d) => fs.statSync(path.join(specsDir, d)).isDirectory());

  for (const feature of features) {
    const gatePath = path.join(specsDir, feature, "gates", `${taskId}-gate.sh`);
    if (fs.existsSync(gatePath)) {
      matches.push(feature);
    }
  }

  if (matches.length === 0) {
    throw new CommandError(
      "Feature required. Run 'gwrk project specs' to list features.",
      2,
    );
  }

  if (matches.length > 1) {
    throw new CommandError(
      `Task ID ambiguous across features: ${matches.join(", ")}. Use -f to specify.`,
      2,
    );
  }

  return matches[0];
}

export const gateCommand = new Command("gate")
  .description("Execute gates and enforce truth")
  .argument("[feature]", "Feature ID (optional if --task is provided)")
  .option("-p, --phase <n>", "Phase number to scope to")
  .option("-t, --task <taskId>", "Task ID to check a single gate (e.g., T001)")
  .option("-v, --verbose", "Show full output for failing gates")
  .addHelpText(
    "after",
    `
Type: verifier (read-only)
Format: use gwrk --format json for structured output
Exit codes:
  0: PASS (All checked gates passed)
  1: FAIL (One or more gates failed, or script not found)
  2: Usage error
`,
  )
  .action(
    async (
      feature: string | undefined,
      options: { phase?: string; task?: string; verbose?: boolean },
      command,
    ) => {
      await withSignal("gate", async () => {
        const startTime = Date.now();
        // Traverse up to find root program options
        const out = resolveFormat(command);

        let targetFeature = feature;

        // If --task is provided without a feature, try to infer it.
        if (options.task && !targetFeature) {
          targetFeature = inferFeatureFromTaskId(options.task);
        }

        if (!targetFeature) {
          throw new CommandError(
            "Feature argument is required unless using --task with an inferable ID.",
            2,
          );
        }

        const normalizedFeature = targetFeature.startsWith("specs/")
          ? targetFeature.replace("specs/", "")
          : targetFeature;

        // SINGLE TASK MODE
        if (options.task) {
          const result = await runGateCheck(options.task, normalizedFeature);
          
          if (out.isJson) {
            out.write(result);
          } else {
            if (result.result === "PASS") {
              console.log(`✅ ${result.taskId} PASS`);
            } else {
              console.error(`❌ ${result.taskId} FAIL (exit: ${result.exitCode})`);
              const combined = (result.stdout + result.stderr).trim();
              if (combined) {
                if (options.verbose) {
                  process.stdout.write(`${combined}\n`);
                } else {
                  const lines = combined.split("\n");
                  if (lines.length > 5) {
                    console.log(`  ... (${lines.length - 5} lines truncated, use -v for full output)`);
                  }
                  process.stdout.write(`${lines.slice(-5).join("\n")}\n`);
                }
              }
            }
          }

          if (result.result === "FAIL") {
            process.exitCode = 1;
            if (!out.isJson) fail("gate", 1, Math.round((Date.now() - startTime) / 1000));
          } else {
            if (!out.isJson) success("gate", Math.round((Date.now() - startTime) / 1000));
          }
          return;
        }

        // BATCH MODE (Feature / Phase)
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", normalizedFeature);
        
        if (!fs.existsSync(featureDir)) {
          throw new CommandError(`Feature directory not found: ${featureDir}`, 1);
        }

        if (!out.isJson) {
          banner("gate", { Feature: normalizedFeature, Phase: options.phase ?? "all" });
        }

        const state = loadTaskState(featureDir);
        const tasksToRun: string[] = [];

        for (const phase of state.phases) {
          if (
            options.phase &&
            phase.id !== `phase-${options.phase.padStart(2, "0")}`
          ) {
            continue;
          }

          for (const task of phase.tasks) {
            tasksToRun.push(task.id);
          }
        }

        if (tasksToRun.length === 0) {
          if (out.isJson) {
            out.write([]);
          } else {
            console.log("  No tasks found for this feature/phase.");
            if (!out.isJson) success("gate", Math.round((Date.now() - startTime) / 1000));
          }
          return;
        }

        if (!out.isJson) {
          console.log(`  Found ${tasksToRun.length} gates to check\n`);
        }

        const results: GateCheckResult[] = [];
        let anyFailed = false;
        let passedCount = 0;
        let failedCount = 0;

        for (const taskId of tasksToRun) {
          if (!out.isJson) {
            process.stdout.write(`  ▸ ${taskId}... `);
          }
          const result = await runGateCheck(taskId, normalizedFeature);
          results.push(result);

          if (result.result === "PASS") {
            passedCount++;
            if (!out.isJson) {
              console.log("✅ PASS");
            }
          } else {
            failedCount++;
            anyFailed = true;
            if (!out.isJson) {
              console.log(`❌ FAIL (exit: ${result.exitCode})`);
            }
          }
        }

        if (out.isJson) {
          out.write(results);
        } else {
          console.log(`\n  ${passedCount} passed, ${failedCount} failed / ${results.length} total\n`);
        }

        const durationS = Math.round((Date.now() - startTime) / 1000);
        if (anyFailed) {
          process.exitCode = 1;
            if (!out.isJson) {
              fail("gate", 1, durationS);
              
              if (options.verbose) {
                // Verbose: full output per gate
                console.log(`\n${color.RED}${color.BOLD}Failed Gate Details:${color.RESET}\n`);
                for (const result of results.filter(r => r.result !== "PASS")) {
                   console.log(`${color.RED}--- ${result.taskId} ---${color.RESET}`);
                   const combined = (result.stdout + result.stderr).trim();
                   if (combined) {
                     process.stdout.write(`${combined}\n`);
                   }
                }
              } else {
                // Default: compact — just tell them how to get details
                console.log(`\n  Use ${color.BOLD}gwrk gate ${normalizedFeature} -v${color.RESET} for failure details`);
                console.log(`  Or  ${color.BOLD}gwrk gate -t T001 ${normalizedFeature}${color.RESET} for a single gate\n`);
              }
            }
        } else {
          if (!out.isJson) {
            success("gate", durationS);
          }
        }
      });
    },
  );
