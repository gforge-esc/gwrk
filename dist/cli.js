#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { analyzeCommand } from "./commands/analyze.js";
import { effortCommand } from "./commands/effort.js";
import { initCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { specifyCommand } from "./commands/specify.js";
import { loadConfig } from "./utils/config.js";
const program = new Command();
program
    .name("gwrk")
    .version(pkg.version)
    .description("AI-powered task management for software teams");
program.addCommand(initCommand);
program.addCommand(specifyCommand);
program.addCommand(planCommand);
program.addCommand(analyzeCommand);
program.addCommand(effortCommand);
program.hook("preAction", (thisCommand, actionCommand) => {
    if (actionCommand.name() !== "init") {
        // This will process.exit(1) if config is missing or invalid
        loadConfig(process.cwd());
    }
});
program.parse();
