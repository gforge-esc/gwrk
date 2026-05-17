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
    ["measure", "effort"],
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
        if (cmd.name() !== "compression") {
          expect(
            firstArg.required,
            `Command 'gwrk ${cmdPath.join(" ")}' first argument should be required`,
          ).toBe(true);
        } else {
          expect(
            firstArg.required,
            `Command 'gwrk ${cmdPath.join(" ")}' first argument should be optional`,
          ).toBe(false);
        }
      }
    });
  }
});

describe("CLI Consistency: No Duplicate Surfaces (US-024)", () => {
  it("does not have 'project gates' command (removed in Phase 11)", () => {
    const project = program.commands.find((c) => c.name() === "project");
    if (project) {
      const gates = project.commands.find((c) => c.name() === "gates");
      expect(gates, "'project gates' should have been removed").toBeUndefined();
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
