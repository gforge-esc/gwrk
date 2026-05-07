import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { generatePulseReport, scanRepository } from "../engine/pulse.js";
import type { PulseReport, PulseSnapshot } from "../engine/types.js";
import { loadConfig } from "../utils/config.js";

export function renderPulseTable(report: PulseReport): string {
  let out = "\n=== GWRK PULSE SNAPSHOT ===\n";
  out += `Generated: ${new Date(report.generatedAt).toLocaleString()}\n`;
  out += `Spec Progress: ${report.specProgress.totalSpecs} specs | ${report.specProgress.totalPlans} plans\n\n`;

  for (const snap of report.repositories) {
    out += `${renderSnapshotTable(snap)}\n`;
  }
  return out;
}

export function renderSnapshotTable(snap: PulseSnapshot): string {
  let out = `Repository: ${snap.repoName} (${snap.repoPath})\n`;
  out += `Branch: ${snap.defaultBranch}\n`;
  out += `LOC: ${snap.mainLoc} (Main) / ${snap.draftLoc} (Draft)\n\n`;

  if (snap.weeklyBuckets.length > 0) {
    out += "Week Start | Total LOC | Added | Deleted\n";
    out += "-----------|-----------|-------|--------\n";
    for (const bucket of snap.weeklyBuckets.slice(-4)) {
      // Show last 4 weeks
      const dateStr = bucket.weekStart.split("T")[0];
      out += `${dateStr.padEnd(10)} | ${bucket.totalMain.toString().padEnd(9)} | +${bucket.added.toString().padEnd(4)} | -${bucket.deleted}\n`;
    }
  } else {
    out += "No git history found.\n";
  }
  return out.trimEnd();
}

import { CommandError, withSignal } from "../utils/signal.js";

export function registerPulseCommands(program: Command) {
  registerPulseSubcommands(program);
}

export function registerPulseSubcommands(program: Command) {
  const pulseCmd = program
    .command("pulse")
    .description("Pulse productivity dashboard")
    .option("--json", "Output full PulseReport as JSON")
    .action(async (options, command) => {
      await withSignal("pulse", async () => {
        const config = loadConfig(process.cwd());
        const report = generatePulseReport(config);

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(renderPulseTable(report));
        }
      });
    });

  pulseCmd
    .command("scan <path>")
    .description("Run a historical scan of any git repository")
    .option("--json", "Output PulseSnapshot as JSON")
    .action(async (repoPath, options, command) => {
      await withSignal("pulse scan", async () => {
        const absolutePath = path.resolve(process.cwd(), repoPath);

        if (!fs.existsSync(absolutePath)) {
          throw new CommandError(`Path not found: ${absolutePath}`, 1);
        }

        if (!fs.existsSync(path.join(absolutePath, ".git"))) {
          throw new CommandError(`Not a git repository: ${absolutePath}`, 1);
        }

        const snapshot = scanRepository(absolutePath);

        if (options.json) {
          console.log(JSON.stringify(snapshot, null, 2));
        } else {
          console.log(renderSnapshotTable(snapshot));
        }
      });
    });
}
