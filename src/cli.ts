#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fileURLToPath } from "node:url";
import { Command, type ParseOptions } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
  CliExit,
  exitCli,
  getOutputScope,
  logCliError,
  runWithOutputScope,
  writeScopedStderr,
  writeScopedStdout,
} from "./adapters/cli/output-scope.js";
import { createAssessCommand } from "./commands/assess.js";
import { createDbCommand } from "./commands/db.js";
import { createDefineCommand } from "./commands/define.js";
import { createDeviceCommand } from "./commands/device.js";
import { createGateCommand } from "./commands/gate.js";
import { createHarvestCommand } from "./commands/harvest.js";
import { createInitCommand } from "./commands/init.js";
import { createMeasureCommand } from "./commands/measure.js";
import { createPlanCommand } from "./commands/plan.js";
import { createPluginCommand } from "./commands/plugin.js";
import { createProjectCommand } from "./commands/project.js";
import { createSandboxCommand } from "./commands/sandbox.js";
import { createServerCommand } from "./commands/server.js";
import { createShipCommand } from "./commands/ship.js";
import { createSkillCommand } from "./commands/skill.js";
import { createStatusCommand } from "./commands/status.js";
import { createTasksCommand } from "./commands/tasks.js";
import { createTestCommand } from "./commands/test.js";
import { loadConfig } from "./utils/config.js";
import { color } from "./utils/format.js";

const { BOLD, DIM, CYAN, MAGENTA, YELLOW, GREEN, RED, RESET } = color;

class ScopedCommand extends Command {
  override parse(argv?: readonly string[], options?: ParseOptions): this {
    if (getOutputScope()) return super.parse(argv, options);
    return runWithOutputScope({ agentMode: false }, () =>
      super.parse(argv, options),
    );
  }

  override parseAsync(
    argv?: readonly string[],
    options?: ParseOptions,
  ): Promise<this> {
    if (getOutputScope()) return super.parseAsync(argv, options);
    return runWithOutputScope({ agentMode: false }, () =>
      super.parseAsync(argv, options),
    );
  }
}

export function createCliProgram(): Command {
  const program = new ScopedCommand();

  program.configureOutput({
    writeOut: writeScopedStdout,
    writeErr: writeScopedStderr,
  });

  program.exitOverride();
  program.enablePositionalOptions();

  program
    .name("gwrk")
    .version(pkg.version)
    .description("The Principal Engineer's Operating System")
    .option("--format <type>", "Output format (json)")
    .option("--workspace <name>", "Select a workspace profile")
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
            "assess",
            "tasks",
            "plan",
            "db",
            "server",
            "device",
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

  program.addCommand(createInitCommand());
  program.addCommand(createAssessCommand());
  program.addCommand(createProjectCommand());

  // The Foxtrot Charlie Pillars
  program.addCommand(createDefineCommand()); // Define: spec → plan → tasks → analyze
  program.addCommand(createShipCommand()); // Ship: autonomous implement → review → PR loop
  program.addCommand(createTestCommand()); // Test: run vitest scoped to feature
  program.addCommand(createGateCommand()); // Gate: execute gates and enforce truth
  program.addCommand(createHarvestCommand()); // Harvest: post-merge lifecycle
  program.addCommand(createMeasureCommand()); // Measure: pulse, effort, compression

  // Operational queries
  program.addCommand(createTasksCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createDbCommand());
  program.addCommand(createServerCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createSandboxCommand()); // Sandbox: inspect + reap ship worktree sandboxes
  program.addCommand(createDeviceCommand());
  program.addCommand(createSkillCommand());
  program.addCommand(createPluginCommand());

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
    const scope = getOutputScope();
    if (scope) scope.agentMode ||= opts.agent || process.env.GWRK_AGENT === "1";

    if (opts.format && opts.format !== "json") {
      logCliError(`Unknown format: ${opts.format}. Supported: json`);
      exitCli(2);
    }

    // Commands that resolve the project root themselves are exempt from the
    // cwd-anchored preflight. `loadConfig` joins its argument with
    // `.gwrkrc.json` and never walks parents, so preflighting it against
    // `process.cwd()` makes every command root-only. `init` has no project yet;
    // `define adr` walks parents for the marker (adr-scaffold.ts `findProjectRoot`)
    // and must work from any subdirectory (FR-002, US-001 scenario 3), so
    // preflighting it here would defeat the walk before the handler runs.
    const commandPath = [actionCommand.parent?.name(), actionCommand.name()]
      .filter(Boolean)
      .join(" ");
    const resolvesOwnRoot =
      actionCommand.name() === "init" ||
      actionCommand.name() === "assess" ||
      commandPath === "define adr";

    if (!resolvesOwnRoot) {
      loadConfig(process.cwd());
    }
  });
  return program;
}

export const program = createCliProgram();

export interface RunCliOptions {
  agentMode?: boolean;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  options: RunCliOptions = {},
): Promise<number> {
  const scope = {
    ...options,
    agentMode: options.agentMode ?? false,
    exitCode: 0,
  };
  return runWithOutputScope(scope, async () => {
    try {
      await createCliProgram().parseAsync(argv, { from: "user" });
      return scope.exitCode;
    } catch (err: unknown) {
      if (err instanceof CliExit) return err.exitCode;
      const error = err as {
        code?: string;
        exitCode?: number;
        message?: string;
      };
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return 0;
      }
      if (error.code === "commander.unknownCommand") {
        logCliError(
          "Unknown command. Run 'gwrk --help' to see available commands.",
        );
        return 127;
      }
      if (
        error.code === "commander.missingArgument" ||
        error.code === "commander.unknownOption" ||
        error.code === "commander.missingMandatoryOptionValue"
      ) {
        return 2;
      }
      if (!error.code?.startsWith("commander.")) {
        logCliError(error.message ?? String(err));
      }
      return error.exitCode || 1;
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
