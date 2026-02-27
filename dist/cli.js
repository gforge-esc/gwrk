#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { loadConfig } from "./utils/config.js";
const program = new Command();
program
  .name("gwrk")
  .version("0.1.0")
  .description("AI-powered task management for software teams");
program.addCommand(initCommand);
program.hook("preAction", (thisCommand, actionCommand) => {
  if (actionCommand.name() !== "init") {
    // This will process.exit(1) if config is missing or invalid
    loadConfig(process.cwd());
  }
});
program.parse();
