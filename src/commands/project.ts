import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { discoverProject } from "../engine/discover.js";
import { type CommandMeta, applyMeta } from "../utils/help.js";
import { resolveFormat } from "../utils/output.js";
import { withSignal } from "../utils/signal.js";

export const projectCommand = new Command("project").description(
  "Query project state",
);

applyMeta(projectCommand, {
  type: "query",
  supportsJson: true,
  exitCodes: {
    0: "Success",
    1: "Not a gwrk project or git missing",
    2: "Usage error",
  },
});

const discoverCmd = projectCommand
  .command("discover")
  .description("Return structured summary of project state")
  .action(async (options, command) => {
    await withSignal("project discover", async () => {
      const out = resolveFormat(command);

      const discovery = await discoverProject(process.cwd());

      if (out.isJson) {
        out.write(discovery);
      } else {
        out.write(`Project: ${discovery.project.name}\n`);
        out.write(`Root: ${discovery.project.root}\n`);
        out.write(
          `Git: branch=${discovery.project.git.branch}, clean=${discovery.project.git.clean}, last=${discovery.project.git.lastCommit}\n\n`,
        );

        out.write("\nSpecs:\n");
        for (const spec of discovery.specs) {
          out.write(
            `- ${spec.id}: ${spec.name} [${spec.status}] (${spec.tasksComplete}/${spec.tasksComplete + spec.tasksOpen} tasks)\n`,
          );
        }

        out.write(
          `\nGates: ${discovery.gates.total} total, ${discovery.gates.passing} passing, ${discovery.gates.failing} failing\n`,
        );
      }
    });
  });

applyMeta(discoverCmd, {
  type: "query",
  supportsJson: true,
  outputs: "ProjectDiscovery (DM-001)",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});

const specsCmd = projectCommand
  .command("specs")
  .description("List all specifications with status")
  .action(async (options, command) => {
    await withSignal("project specs", async () => {
      const out = resolveFormat(command);

      const discovery = await discoverProject(process.cwd());

      if (out.isJson) {
        out.write(discovery.specs);
      } else {
        out.write("ID   | Status   | Tasks | Name\n");
        out.write("-----|----------|-------|-----\n");
        for (const spec of discovery.specs) {
          const tasks = `${spec.tasksComplete}/${spec.tasksComplete + spec.tasksOpen}`;
          out.write(
            `${spec.id.padEnd(4)} | ${spec.status.padEnd(8)} | ${tasks.padEnd(5)} | ${spec.name}\n`,
          );
        }
      }
    });
  });

applyMeta(specsCmd, {
  type: "query",
  supportsJson: true,
  outputs: "SpecSummary[]",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});

const gatesCmd = projectCommand
  .command("gates")
  .option("--run", "Execute each gate and report results (default: list only)")
  .description("List or run gate scripts grouped by feature")
  .action(async (options, command) => {
    await withSignal("project gates", async () => {
      const out = resolveFormat(command);
      const localOpts = command.opts();
      const shouldRun = localOpts.run === true;

      const results: Array<{
        taskId: string;
        feature: string;
        gatePath: string;
        exists: boolean;
        result?: "PASS" | "FAIL";
        durationMs?: number;
      }> = [];

      for (const spec of (await discoverProject(process.cwd())).specs) {
        const gatesDir = path.join(process.cwd(), spec.dirPath, "gates");
        if (!fs.existsSync(gatesDir)) continue;

        const gateFiles = fs
          .readdirSync(gatesDir)
          .filter((f) => f.endsWith("-gate.sh"));
        for (const file of gateFiles) {
          const taskId = file.replace("-gate.sh", "");
          const gatePath = path.join(spec.dirPath, "gates", file);
          const entry: (typeof results)[0] = {
            taskId,
            feature: spec.id,
            gatePath,
            exists: true,
          };

          if (shouldRun) {
            const start = Date.now();
            try {
              const { execCommand } = await import("../utils/exec.js");
              const res = await execCommand(
                "bash",
                [path.join(process.cwd(), gatePath)],
                undefined,
                { cwd: process.cwd() },
              );
              entry.result = res.exitCode === 0 ? "PASS" : "FAIL";
            } catch {
              entry.result = "FAIL";
            }
            entry.durationMs = Date.now() - start;
          }

          results.push(entry);
        }
      }

      if (out.isJson) {
        out.write(results);
      } else if (shouldRun) {
        out.write("Task | Feature         | Result | Duration\n");
        out.write("-----|-----------------|--------|----------\n");
        for (const res of results) {
          const dur = res.durationMs ? `${res.durationMs}ms` : "-";
          const icon = res.result === "PASS" ? "✅" : "❌";
          out.write(
            `${res.taskId.padEnd(4)} | ${res.feature.padEnd(15)} | ${icon} ${(res.result ?? "-").padEnd(4)} | ${dur}\n`,
          );
        }
        const passing = results.filter((r) => r.result === "PASS").length;
        const failing = results.filter((r) => r.result === "FAIL").length;
        out.write(
          `\n${results.length} gates: ${passing} passing, ${failing} failing\n`,
        );
      } else {
        out.write("Task | Feature         | Gate Path\n");
        out.write("-----|-----------------|----------\n");
        for (const res of results) {
          out.write(
            `${res.taskId.padEnd(4)} | ${res.feature.padEnd(15)} | ${res.gatePath}\n`,
          );
        }
        out.write(`\nRun 'gwrk project gates --run' to execute all gates.\n`);
      }
    });
  });

applyMeta(gatesCmd, {
  type: "verifier",
  supportsJson: true,
  outputs: "GateCheckResult[]",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});
