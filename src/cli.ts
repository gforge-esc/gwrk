#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { analyzeCommand } from "./commands/analyze.js";
import { defineCommand } from "./commands/define.js";
import { effortCommand } from "./commands/effort.js";
import { compressionCommand } from "./commands/compression.js";
import { implementCommand } from "./commands/implement.js";
import { initCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { runsCommand } from "./commands/runs.js";
import { registerPulseCommands } from "./commands/pulse.js";
import { specifyCommand } from "./commands/specify.js";
import { tasksCommand } from "./commands/tasks.js";
import { wudCommand } from "./commands/wud.js";
import { statsCommand } from "./commands/stats.js";
import { loadConfig } from "./utils/config.js";

export const program = new Command();

program
  .name("gwrk")
  .version(pkg.version)
  .description("AI-powered task management for software teams");

program.addCommand(initCommand);
program.addCommand(specifyCommand);
program.addCommand(planCommand);
program.addCommand(analyzeCommand);
program.addCommand(effortCommand);
program.addCommand(compressionCommand);
program.addCommand(tasksCommand);
program.addCommand(wudCommand);
program.addCommand(defineCommand);
program.addCommand(implementCommand);
program.addCommand(runsCommand);
program.addCommand(statsCommand);
registerPulseCommands(program);

program.hook("preAction", (thisCommand, actionCommand) => {
  if (actionCommand.name() !== "init") {
    // This will process.exit(1) if config is missing or invalid
    loadConfig(process.cwd());
  }
});

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  program.parse();
}
