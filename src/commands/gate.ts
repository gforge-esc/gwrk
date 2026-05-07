import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { runGate } from "../utils/exec.js";
import { banner, color, fail, success } from "../utils/format.js";
import { resolveFormat } from "../utils/output.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { CommandError, withSignal } from "../utils/signal.js";
import { loadTaskState } from "../utils/state.js";

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
 * Anti-pattern pre-flight guard.
 *
 * Scans source/test files associated with a task for known stub patterns
 * BEFORE the gate script runs. This is hard-coded in the gate runner
 * and cannot be gamed by agent-authored gate scripts.
 *
 * Known anti-patterns:
 * - throw "not implemented" / "Method not implemented" in source
 * - describe.skip / it.skip / test.skip in test files
 * - "not yet implemented" in CLI command handlers
 */
function preFlightCheck(
  taskId: string,
  feature: string,
  projectRoot: string,
): string[] {
  const violations: string[] = [];
  const featureDir = path.join(projectRoot, "specs", feature);

  // Load task state to find referenced files and phase scope
  interface TaskInfo {
    id: string;
    title: string;
    description?: string;
    status?: string;
  }
  interface PhaseInfo {
    id: string;
    tasks: TaskInfo[];
  }

  let task: TaskInfo | undefined;
  let taskPhase: PhaseInfo | undefined;
  let allPhases: PhaseInfo[] = [];
  try {
    const state = loadTaskState(featureDir);
    allPhases = state.phases;
    for (const phase of state.phases) {
      const found = phase.tasks.find((t) => t.id === taskId);
      if (found) {
        task = found;
        taskPhase = phase;
        break;
      }
    }
  } catch {
    return violations; // No tasks.json — skip pre-flight
  }

  if (!task || !taskPhase) return violations;

  // Extract source file path from task title (e.g. "Implement src/engine/foo.ts")
  const fileMatch = task.title.match(
    /(?:Implement|Modify)\s+(src\/[^\s,]+\.ts)/,
  );
  if (fileMatch) {
    const targetFile = fileMatch[1];
    const filePath = path.join(projectRoot, targetFile);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");

      // Check if OTHER phases also reference this same file
      // (e.g., plan.ts is touched by Phase 3, 4, AND 5)
      const otherPhasesReferenceFile = allPhases
        .filter((p) => p.id !== taskPhase?.id)
        .some((p) =>
          p.tasks.some(
            (t) => t.title.includes(targetFile) && t.status !== "completed",
          ),
        );

      // Only flag stubs if no other incomplete phase owns this file
      // If another phase legitimately has stubs (from define-tests), skip
      if (!otherPhasesReferenceFile) {
        const stubPatterns: [RegExp, string][] = [
          [
            /throw new Error\(["'](?:Method )?not implemented/,
            "throws 'not implemented'",
          ],
          [
            /throw new CommandError\([^)]*not yet implemented/,
            "throws 'not yet implemented'",
          ],
        ];

        for (const [pattern, label] of stubPatterns) {
          if (pattern.test(content)) {
            violations.push(`STUB in ${targetFile}: ${label}`);
          }
        }
      }
    }

    // Check for associated test file with .skip() blocks
    const testPath = targetFile.replace(/\.ts$/, ".test.ts");
    const absTestPath = path.join(projectRoot, testPath);
    if (fs.existsSync(absTestPath)) {
      const testContent = fs.readFileSync(absTestPath, "utf-8");
      if (/describe\.skip\s*\(/.test(testContent)) {
        violations.push(
          `SKIPPED TESTS in ${testPath}: describe.skip() bypasses gate verification`,
        );
      }
    }
  }

  // Also check if the task title mentions "test strategy" — scan for skips
  if (/test strategy/i.test(task.title)) {
    const taskDesc = task.description || "";
    const testFiles = taskDesc.match(/src\/[^\s,]+\.test\.ts/g) || [];
    for (const tf of testFiles) {
      const absTf = path.join(projectRoot, tf);
      if (fs.existsSync(absTf)) {
        const tfContent = fs.readFileSync(absTf, "utf-8");
        if (/describe\.skip\s*\(/.test(tfContent)) {
          violations.push(
            `SKIPPED TESTS in ${tf}: describe.skip() bypasses gate verification`,
          );
        }
      }
    }
  }

  return violations;
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
      `Gate script not found: ${gatePath}. Run 'gwrk gate <feature>' to check gates.`,
      1,
    );
  }

  // ── Anti-pattern pre-flight ──
  // Hard-coded guard that runs BEFORE the gate script.
  // Catches stubs and skipped tests that would pass gates vacuously.
  const violations = preFlightCheck(taskId, normalizedFeature, projectRoot);
  if (violations.length > 0) {
    const violationMsg = violations
      .map((v) => `  ⚠ PRE-FLIGHT: ${v}`)
      .join("\n");
    return {
      taskId,
      feature: normalizedFeature,
      gatePath,
      result: "FAIL",
      exitCode: 1,
      stdout: "",
      stderr: `Gate pre-flight failed — anti-pattern detected:\n${violationMsg}`,
      durationMs: 0,
    };
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

Examples:
  gwrk gate 006              Run all gates for feature 006
  gwrk gate 008 -p 03        Run gates for phase 03 only
  gwrk gate -t T011          Run a single gate (auto-detects feature)
  gwrk gate 008 -t T011 -v   Run single gate with verbose output
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

        const normalizedFeature = resolveFeature(
          targetFeature.startsWith("specs/")
            ? targetFeature.replace("specs/", "")
            : targetFeature,
        );

        // SINGLE TASK MODE
        if (options.task) {
          const result = await runGateCheck(options.task, normalizedFeature);

          if (out.isJson) {
            out.write(result);
          } else {
            if (result.result === "PASS") {
              console.log(`✅ ${result.taskId} PASS`);
            } else {
              console.error(
                `❌ ${result.taskId} FAIL (exit: ${result.exitCode})`,
              );
              const combined = (result.stdout + result.stderr).trim();
              if (combined) {
                if (options.verbose) {
                  process.stdout.write(`${combined}\n`);
                } else {
                  const lines = combined.split("\n");
                  if (lines.length > 5) {
                    console.log(
                      `  ... (${lines.length - 5} lines truncated, use -v for full output)`,
                    );
                  }
                  process.stdout.write(`${lines.slice(-5).join("\n")}\n`);
                }
              }
            }
          }

          if (result.result === "FAIL") {
            process.exitCode = 1;
            if (!out.isJson)
              fail("gate", 1, Math.round((Date.now() - startTime) / 1000));
          } else {
            if (!out.isJson)
              success("gate", Math.round((Date.now() - startTime) / 1000));
          }
          return;
        }

        // BATCH MODE (Feature / Phase)
        const projectRoot = process.cwd();
        const featureDir = path.join(projectRoot, "specs", normalizedFeature);

        if (!fs.existsSync(featureDir)) {
          throw new CommandError(
            `Feature directory not found: ${featureDir}`,
            1,
          );
        }

        if (!out.isJson) {
          banner("gate", {
            Feature: normalizedFeature,
            Phase: options.phase ?? "all",
          });
        }

        const state = loadTaskState(featureDir);
        const results: GateCheckResult[] = [];
        let anyFailed = false;
        let totalPassed = 0;
        let totalFailed = 0;

        for (const phase of state.phases) {
          if (
            options.phase &&
            phase.id !== `phase-${options.phase.padStart(2, "0")}`
          ) {
            continue;
          }

          const phaseNum = phase.id.replace("phase-", "");
          const phaseResults: GateCheckResult[] = [];

          for (const task of phase.tasks) {
            if (!out.isJson) {
              process.stdout.write(
                `  ${color.DIM}▸${color.RESET} ${task.id}... `,
              );
            }
            const result = await runGateCheck(task.id, normalizedFeature);
            results.push(result);
            phaseResults.push(result);

            if (result.result === "PASS") {
              totalPassed++;
              if (!out.isJson) {
                console.log("✅ PASS");
              }
            } else {
              totalFailed++;
              anyFailed = true;
              if (!out.isJson) {
                console.log(`❌ FAIL (exit: ${result.exitCode})`);
              }
            }
          }

          // Phase summary line
          if (!out.isJson && phaseResults.length > 0) {
            const pPassed = phaseResults.filter(
              (r) => r.result === "PASS",
            ).length;
            const pTotal = phaseResults.length;
            const phaseIcon = pPassed === pTotal ? "✅" : "🔴";
            console.log(
              `  ${color.DIM}────${color.RESET} Phase ${phaseNum}: ${pPassed}/${pTotal} ${phaseIcon}\n`,
            );
          }
        }

        if (out.isJson) {
          out.write(results);
        } else {
          console.log(
            `  ${totalPassed} passed, ${totalFailed} failed / ${results.length} total\n`,
          );
        }

        const durationS = Math.round((Date.now() - startTime) / 1000);
        if (anyFailed) {
          process.exitCode = 1;
          if (!out.isJson) {
            fail("gate", 1, durationS);

            if (options.verbose) {
              // Verbose: full output per gate
              console.log(
                `\n${color.RED}${color.BOLD}Failed Gate Details:${color.RESET}\n`,
              );
              for (const result of results.filter((r) => r.result !== "PASS")) {
                console.log(
                  `${color.RED}--- ${result.taskId} ---${color.RESET}`,
                );
                const combined = (result.stdout + result.stderr).trim();
                if (combined) {
                  process.stdout.write(`${combined}\n`);
                }
              }
            } else {
              // Default: compact — just tell them how to get details
              console.log(
                `\n  Use ${color.BOLD}gwrk gate ${normalizedFeature} -v${color.RESET} for failure details`,
              );
              console.log(
                `  Or  ${color.BOLD}gwrk gate -t T001 ${normalizedFeature}${color.RESET} for a single gate\n`,
              );
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
