#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { initCommand } from "./commands/init.js";
import { defineCommand } from "./commands/define.js";
import { shipCommand } from "./commands/ship.js";
import { measureCommand } from "./commands/measure.js";
import { tasksCommand } from "./commands/tasks.js";
import { dbCommand } from "./commands/db.js";
import { loadConfig } from "./utils/config.js";
import { color } from "./utils/format.js";
const { BOLD, DIM, CYAN, MAGENTA, YELLOW, GREEN, RED, RESET } = color;
export const program = new Command();
program
    .name("gwrk")
    .version(pkg.version)
    .description("The Principal Engineer's Operating System")
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
            const pillars = ["define", "ship", "measure"];
            const ops = ["init", "tasks", "db"];
            out += `  ${CYAN}Foxtrot Charlie${RESET}\n`;
            for (const name of pillars) {
                const sub = cmds.find(c => c.name() === name);
                if (sub) {
                    out += `    ${GREEN}${sub.name().padEnd(12)}${RESET} ${DIM}${sub.description()}${RESET}\n`;
                }
            }
            out += "\n";
            out += `  ${CYAN}Operations${RESET}\n`;
            for (const name of ops) {
                const sub = cmds.find(c => c.name() === name);
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
// The Foxtrot Charlie Pillars
program.addCommand(defineCommand); // Define: spec → plan → tasks → analyze
program.addCommand(shipCommand); // Ship: autonomous implement → review → PR loop
program.addCommand(measureCommand); // Measure: pulse, effort, compression
// Operational queries
program.addCommand(tasksCommand);
program.addCommand(dbCommand);
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
