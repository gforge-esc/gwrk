import { Command } from "commander";
import { discoverProject } from "../engine/discover.js";
import { createOutput } from "../utils/output.js";
import { withSignal } from "../utils/signal.js";
import { applyMeta, type CommandMeta } from "../utils/help.js";
import fs from "node:fs";
import path from "node:path";

export const projectCommand = new Command("project")
  .description("Query project state");

applyMeta(projectCommand, {
  type: "query",
  formats: ["human", "json"],
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
      let rootCmd = command;
      while (rootCmd.parent) rootCmd = rootCmd.parent;
      const globalOpts = rootCmd.opts();
      const out = createOutput(globalOpts.format || "human");

      const discovery = await discoverProject(process.cwd());

      if (globalOpts.format === "json") {
        out.write(discovery);
      } else {
        out.write(`Project: ${discovery.project.name}\n`);
        out.write(`Root: ${discovery.project.root}\n`);
        out.write(`Git: branch=${discovery.project.git.branch}, clean=${discovery.project.git.clean}, last=${discovery.project.git.lastCommit}\n\n`);
        
        out.write("\nSpecs:\n");
        for (const spec of discovery.specs) {
          out.write(`- ${spec.id}: ${spec.name} [${spec.status}] (${spec.tasksComplete}/${spec.tasksComplete + spec.tasksOpen} tasks)\n`);
        }
        
        out.write(`\nGates: ${discovery.gates.total} total, ${discovery.gates.passing} passing, ${discovery.gates.failing} failing\n`);
      }
    });
  });

applyMeta(discoverCmd, {
  type: "query",
  formats: ["human", "json"],
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
      let rootCmd = command;
      while (rootCmd.parent) rootCmd = rootCmd.parent;
      const globalOpts = rootCmd.opts();
      const out = createOutput(globalOpts.format || "human");

      const discovery = await discoverProject(process.cwd());
      
      if (globalOpts.format === "json") {
        out.write(discovery.specs);
      } else {
        out.write("ID   | Status   | Tasks | Name\n");
        out.write("-----|----------|-------|-----\n");
        for (const spec of discovery.specs) {
          const tasks = `${spec.tasksComplete}/${spec.tasksComplete + spec.tasksOpen}`;
          out.write(`${spec.id.padEnd(4)} | ${spec.status.padEnd(8)} | ${tasks.padEnd(5)} | ${spec.name}\n`);
        }
      }
    });
  });

applyMeta(specsCmd, {
  type: "query",
  formats: ["human", "json"],
  outputs: "SpecSummary[]",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});

const gatesCmd = projectCommand
  .command("gates")
  .description("List gate scripts grouped by feature")
  .action(async (options, command) => {
    await withSignal("project gates", async () => {
      let rootCmd = command;
      while (rootCmd.parent) rootCmd = rootCmd.parent;
      const globalOpts = rootCmd.opts();
      const out = createOutput(globalOpts.format || "human");

      const discovery = await discoverProject(process.cwd());
      const results: Array<{
        taskId: string;
        feature: string;
        gatePath: string;
        exists: boolean;
      }> = [];

      for (const spec of discovery.specs) {
        const gatesDir = path.join(process.cwd(), spec.dirPath, "gates");
        if (!fs.existsSync(gatesDir)) continue;

        const gateFiles = fs
          .readdirSync(gatesDir)
          .filter((f) => f.endsWith("-gate.sh"));
        for (const file of gateFiles) {
          const taskId = file.replace("-gate.sh", "");
          results.push({
            taskId,
            feature: spec.id,
            gatePath: path.join(spec.dirPath, "gates", file),
            exists: true,
          });
        }
      }

      if (globalOpts.format === "json") {
        out.write(results);
      } else {
        out.write("Task | Feature         | Gate Path\n");
        out.write("-----|-----------------|----------\n");
        for (const res of results) {
          out.write(
            `${res.taskId.padEnd(4)} | ${res.feature.padEnd(15)} | ${res.gatePath}\n`,
          );
        }
      }
    });
  });

applyMeta(gatesCmd, {
  type: "verifier",
  formats: ["human", "json"],
  outputs: "GateCheckResult[]",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});
