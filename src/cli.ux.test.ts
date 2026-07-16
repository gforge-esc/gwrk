/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { program } from "./cli.js";

// In-process help inspection — no `node dist/cli.js` spawn per command. The old
// version spawned the built CLI 11 times (~0.2s locally, ~5s on CI ≈ 48s total),
// which tripped the vitest worker-RPC timeout. Importing `program` is safe:
// cli.ts only calls program.parse() when it is the entry point.

/** Resolve a space-separated command path (e.g. "define spec") to its Command. */
function findCommand(pathStr: string): Command {
  let cmd: Command = program;
  for (const name of pathStr.split(" ")) {
    const next = cmd.commands.find(
      (c) => c.name() === name || c.aliases().includes(name),
    );
    if (!next) throw new Error(`command not found: "${pathStr}" (at "${name}")`);
    cmd = next;
  }
  return cmd;
}

/** Full help text including addHelpText("after", ...) hooks (the Examples block). */
function helpText(cmd: Command): string {
  let out = "";
  cmd.configureOutput({
    writeOut: (s) => {
      out += s;
    },
    writeErr: (s) => {
      out += s;
    },
  });
  cmd.outputHelp();
  return out;
}

describe("CLI UX: Help Text Examples (Phase 11)", () => {
  const commandsWithExamples = [
    "ship",
    "define spec",
    "define plan",
    "define tasks",
    "tasks list",
    "tasks next",
    "tasks done",
    "measure pulse",
    "measure compression",
    "db runs",
    "test",
  ];

  for (const cmd of commandsWithExamples) {
    it(`gwrk ${cmd} --help shows 'Examples:' section (US-022)`, () => {
      expect(
        helpText(findCommand(cmd)),
        `Command 'gwrk ${cmd}' is missing 'Examples:' section in help`,
      ).toMatch(/Examples:/i);
    });
  }
});
