import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { runGate } from "../utils/exec.js";
import { createOutput } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * GateCheckResult schema (DM-002)
 */
export interface GateCheckResult {
  taskId: string;
  feature: string;
  gatePath: string;
  result: "PASS" | "FAIL";
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
    feature,
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

export const gateCheckCommand = new Command("gate-check")
  .description("Execute a specific task gate and return structured result")
  .argument("<task_id>", "Task ID (e.g., T001)")
  .option("-f, --feature <dir>", "Feature directory (e.g., 001-cli-core)")
  .action(async (taskId: string, options, command) => {
    await withSignal("gate-check", async () => {
      // Traverse up to find root program options
      let root = command;
      while (root.parent) root = root.parent;
      const globalOpts = root.opts();
      const out = createOutput(globalOpts.format || "human");

      let feature = options.feature;
      if (!feature) {
        feature = inferFeatureFromTaskId(taskId);
      }

      const result = await runGateCheck(taskId, feature);

      if (globalOpts.format === "json") {
        out.write(result);
      } else {
        if (result.result === "PASS") {
          console.log(`✅ ${taskId} PASS`);
        } else {
          console.error(`❌ ${taskId} FAIL (exit: ${result.exitCode})`);
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);
        }
      }

      if (result.result === "FAIL") {
        process.exitCode = 1;
      }
    });
  });
