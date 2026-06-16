/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { program } from "./cli.js";

describe("CLI Consistency: Feature Argument Position (US-023)", () => {
  const featureScopedCommands = [
    ["define", "spec"],
    ["define", "plan"],
    ["define", "tasks"],
    ["ship"],
    ["tasks", "list"],
    ["tasks", "next"],
    ["tasks", "done"],
    ["measure", "compression"],
    ["db", "runs"],
    ["test"],
  ];

  function findCommand(path: string[]): Command | undefined {
    let current: Command = program;
    for (const name of path) {
      const next = current.commands.find((c) => c.name() === name);
      if (!next) return undefined;
      current = next;
    }
    return current;
  }

  for (const cmdPath of featureScopedCommands) {
    it(`command 'gwrk ${cmdPath.join(" ")}' has <feature> as first positional argument`, () => {
      const cmd = findCommand(cmdPath);
      expect(
        cmd,
        `Command 'gwrk ${cmdPath.join(" ")}' not found`,
      ).toBeDefined();

      if (cmd) {
        const firstArg = (cmd as any)._args[0];
        expect(
          firstArg,
          `Command 'gwrk ${cmdPath.join(" ")}' has no positional arguments`,
        ).toBeDefined();
        expect(
          firstArg.name(),
          `Command 'gwrk ${cmdPath.join(" ")}' first argument should be 'feature' or 'featureId'`,
        ).toMatch(/feature/i);

        // compression feature arg is optional because of --all flag
        // define spec feature arg is optional because of creation mode
        const optionalFeatureCommands = ["compression", "spec"];
        if (optionalFeatureCommands.includes(cmd.name())) {
          expect(
            firstArg.required,
            `Command 'gwrk ${cmdPath.join(" ")}' first argument should be optional`,
          ).toBe(false);
        } else {
          expect(
            firstArg.required,
            `Command 'gwrk ${cmdPath.join(" ")}' first argument should be required`,
          ).toBe(true);
        }
      }
    });
  }
});

describe("CLI Consistency: No Duplicate Surfaces (US-024)", () => {
  it("'project gates' is summary-only (FR-005), 'gwrk gate' executes (FR-006)", () => {
    const project = program.commands.find((c) => c.name() === "project");
    const topGate = program.commands.find((c) => c.name() === "gate");
    // Both should exist: project gates (summary) + top-level gate (execution)
    expect(project, "project command must exist").toBeDefined();
    expect(topGate, "top-level gate command must exist").toBeDefined();
    if (project) {
      const gates = project.commands.find((c) => c.name() === "gates");
      expect(gates, "'project gates' provides summary (FR-005)").toBeDefined();
    }
  });

  it("does not have 'gate' as a subcommand of 'ship' (US-018)", () => {
    const ship = program.commands.find((c) => c.name() === "ship");
    if (ship) {
      const gate = ship.commands.find((c) => c.name() === "gate");
      expect(gate, "'ship gate' should not exist").toBeUndefined();
    }
  });
});
