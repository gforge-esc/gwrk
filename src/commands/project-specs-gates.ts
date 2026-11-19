/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import {
  exitCli,
  writeScopedStderr,
  writeScopedStdout,
} from "../adapters/cli/output-scope.js";
import { discoverProject } from "../engine/discover.js";
import { withSignal } from "../utils/signal.js";

/**
 * FR-005: `gwrk project specs`
 * Lists all specs with their status, plan, and task state.
 */
export const createProjectSpecsCommand = () =>
  new Command("specs")
    .description("List all specs and their readiness status")
    .option("--format <type>", "Output format (text, json)", "text")
    .action(async (options) => {
      await withSignal("project specs", async () => {
        const result = await discoverProject(process.cwd());

        if (options.format === "json") {
          writeScopedStdout(`${JSON.stringify(result.specs, null, 2)}\n`);
          return;
        }

        if (result.specs.length === 0) {
          writeScopedStdout("No specs found.\n");
          return;
        }

        // Table header
        const statusIcon = (s: string) => {
          if (s === "shipped") return "✅";
          if (s === "tasked") return "🔴";
          if (s === "planned") return "🟡";
          return "⚪";
        };

        writeScopedStdout(
          "ID   Name                         Status    Plan  Tasks\n",
        );
        writeScopedStdout(
          "───  ───────────────────────────  ────────  ────  ─────\n",
        );

        for (const s of result.specs) {
          const id = s.id.padEnd(4);
          const name = s.name.slice(0, 27).padEnd(27);
          const status = `${statusIcon(s.status)} ${s.status}`.padEnd(10);
          const plan = s.hasPlan ? "yes" : " - ";
          const tasks = s.hasTasks
            ? `${s.tasksComplete}/${s.tasksComplete + s.tasksOpen}`
            : " - ";
          writeScopedStdout(
            `${id} ${name}  ${status}${plan.padEnd(6)}${tasks}\n`,
          );
        }

        writeScopedStdout(`\n${result.specs.length} specs total\n`);
      });
    });

export const projectSpecsCommand = createProjectSpecsCommand();

/**
 * FR-005: `gwrk project gates`
 * Shows gate summary across all specs, optionally filtered to a feature.
 */
export const createProjectGatesCommand = () =>
  new Command("gates")
    .description("Show gate summary across all specs")
    .argument(
      "[feature]",
      "Filter to a specific feature (e.g. 013 or agent-native)",
    )
    .option("--format <type>", "Output format (text, json)", "text")
    .action(
      async (feature: string | undefined, options: { format: string }) => {
        await withSignal("project gates", async () => {
          const result = await discoverProject(process.cwd());

          // Filter specs if feature provided
          let specs = result.specs;
          if (feature) {
            specs = specs.filter(
              (s) =>
                s.id === feature ||
                s.name.includes(feature) ||
                s.dirPath.includes(feature),
            );
            if (specs.length === 0) {
              writeScopedStderr(
                `No specs matching '${feature}'. Run 'gwrk project specs' to list all.\n`,
              );
              exitCli(1);
            }
          }

          // Count gates per spec
          const fs = await import("node:fs");
          const path = await import("node:path");
          const perSpec: Array<{
            id: string;
            name: string;
            gateCount: number;
          }> = [];
          let total = 0;

          for (const s of specs) {
            const gatesDir = path.join(process.cwd(), s.dirPath, "gates");
            let gateCount = 0;
            if (fs.existsSync(gatesDir)) {
              gateCount = fs
                .readdirSync(gatesDir)
                .filter((f: string) => f.endsWith("-gate.sh")).length;
            }
            total += gateCount;
            perSpec.push({ id: s.id, name: s.name, gateCount });
          }

          if (options.format === "json") {
            writeScopedStdout(
              `${JSON.stringify({ total, specs: perSpec }, null, 2)}\n`,
            );
            return;
          }

          if (feature && specs.length === 1) {
            const s = perSpec[0];
            writeScopedStdout(`${s.id} ${s.name}: ${s.gateCount} gates\n`);
            if (s.gateCount > 0) {
              writeScopedStdout(
                `\nRun 'gwrk gate ${specs[0].dirPath.split("/").pop()}' to execute.\n`,
              );
            }
            return;
          }

          writeScopedStdout("Gates by spec:\n");
          for (const s of perSpec) {
            if (s.gateCount > 0) {
              writeScopedStdout(
                `  ${s.id.padEnd(4)} ${s.name.slice(0, 30).padEnd(30)} ${s.gateCount}\n`,
              );
            }
          }
          writeScopedStdout(`\n${total} gates total\n`);
        });
      },
    );

export const projectGatesCommand = createProjectGatesCommand();
