#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { dbCommand } from "./commands/db.js";
import { defineCommand } from "./commands/define.js";
import { gateCommand } from "./commands/gate.js";
import { harvestCommand } from "./commands/harvest.js";
import { initCommand } from "./commands/init.js";
import { measureCommand } from "./commands/measure.js";
import { planCommand } from "./commands/plan.js";
import { pluginCommand } from "./commands/plugin.js";
import { projectCommand } from "./commands/project.js";
import { serverCommand } from "./commands/server.js";
import { shipCommand } from "./commands/ship.js";
import { skillCommand } from "./commands/skill.js";
import { statusCommand } from "./commands/status.js";
import { tasksCommand } from "./commands/tasks.js";
import { testCommand } from "./commands/test.js";
import { processForAgent } from "./utils/agent-layer.js";
import { loadConfig } from "./utils/config.js";
import { color } from "./utils/format.js";

const { BOLD, DIM, CYAN, MAGENTA, YELLOW, GREEN, RED, RESET } = color;

export const program = new Command();

program.exitOverride();
program.enablePositionalOptions();

program
  .name("gwrk")
  .version(pkg.version)
  .description("The Principal Engineer's Operating System")
  .option("--format <type>", "Output format (json)")
  .option("--agent", "Enable Agent-Native Mode (TC-006)", false)
  .configureHelp({
    formatHelp: (cmd, helper) => {
      const ver = cmd.version() ?? pkg.version;

      // Header
      let out = "\n";
      out += `  ${MAGENTA}🦩 gwrk${RESET} ${DIM}v${ver}${RESET}\n`;
      out += `  ${DIM}You better gwrk.${RESET}\n`;
      out += "\n";
      out += `  ${BOLD}Truth → Clarity → Throughput → Value.${RESET}\n`;
      out += "\n";

      // Commands, grouped by purpose
      const cmds = cmd.commands;
      if (cmds.length > 0) {
        // Foxtrot Charlie pillars
        const pillars = ["define", "ship", "test", "gate", "measure"];
        const ops = [
          "init",
          "tasks",
          "plan",
          "db",
          "server",
          "status",
          "project",
          "plugin",
        ];

        out += `  ${CYAN}Foxtrot Charlie${RESET}\n`;
        for (const name of pillars) {
          const sub = cmds.find((c) => c.name() === name);
          if (sub) {
            out += `    ${GREEN}${sub.name().padEnd(12)}${RESET} ${DIM}${sub.description()}${RESET}\n`;
          }
        }

        out += "\n";
        out += `  ${CYAN}Operations${RESET}\n`;
        for (const name of ops) {
          const sub = cmds.find((c) => c.name() === name);
          if (sub) {
            out += `    ${sub.name().padEnd(12)} ${DIM}${sub.description()}${RESET}\n`;
          }
        }
      }

      // Options
      const opts = helper.visibleOptions(cmd);
      if (opts.length > 0) {
        out += "\n";
        out += `  ${CYAN}Options${RESET}\n`;
        for (const opt of opts) {
          const flags = opt.flags.padEnd(20);
          out += `    ${DIM}${flags}${RESET} ${opt.description}\n`;
        }
      }

      out += "\n";
      out += `  ${DIM}Run${RESET} gwrk <command> --help ${DIM}for details on any command.${RESET}\n`;
      out += "\n";
      out += `  ${MAGENTA}🦩${RESET} ${DIM}Truth extracted. Clarity committed. Throughput shipped. Value delivered.${RESET}\n`;
      out += "\n";

      return out;
    },
  });

program.addCommand(initCommand);
program.addCommand(projectCommand);

// The Foxtrot Charlie Pillars
program.addCommand(defineCommand); // Define: spec → plan → tasks → analyze
program.addCommand(shipCommand); // Ship: autonomous implement → review → PR loop
program.addCommand(testCommand); // Test: run vitest scoped to feature
program.addCommand(gateCommand); // Gate: execute gates and enforce truth
program.addCommand(harvestCommand); // Harvest: post-merge lifecycle
program.addCommand(measureCommand); // Measure: pulse, effort, compression

// Operational queries
program.addCommand(tasksCommand);
program.addCommand(planCommand);
program.addCommand(dbCommand);
program.addCommand(serverCommand);
program.addCommand(statusCommand);
program.addCommand(skillCommand);
program.addCommand(pluginCommand);

/**
 * Recursively apply exitOverride to a command and all its subcommands.
 */
function applyExitOverride(cmd: Command) {
  cmd.exitOverride();
  for (const sub of cmd.commands) {
    applyExitOverride(sub);
  }
}

applyExitOverride(program);

program.hook("preAction", (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  const isAgent = opts.agent || process.env.GWRK_AGENT === "1";

  if (isAgent) {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (
      chunk: string | Buffer,
      encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
      callback?: (error: Error | null | undefined) => void,
    ): boolean => {
      const data = typeof chunk === "string" ? chunk : chunk.toString();
      const processed = processForAgent(data);

      if (typeof encoding === "function") {
        return originalWrite(processed, encoding);
      }
      return originalWrite(processed, encoding, callback);
    };
  }

  if (opts.format && opts.format !== "json") {
    console.error(`Unknown format: ${opts.format}. Supported: json`);
    process.exit(2);
  }

  if (
    actionCommand.name() !== "init"
  ) {
    // This will process.exit(1) if config is missing or invalid
    loadConfig(process.cwd());
  }
});

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    program.parse();
  } catch (err: unknown) {
    const error = err as { code?: string; exitCode?: number };
    if (error.code === "commander.helpDisplayed") {
      process.exit(0);
    }
    if (error.code === "commander.unknownCommand") {
      console.error(
        `Unknown command. Run 'gwrk --help' to see available commands.`,
      );
      process.exit(127);
    }
    if (
      error.code === "commander.missingArgument" ||
      error.code === "commander.unknownOption" ||
      error.code === "commander.missingMandatoryOptionValue"
    ) {
      process.exit(2);
    }
    // For other commander errors, use their exitCode or default to 1
    process.exit(error.exitCode || 1);
  }
}
