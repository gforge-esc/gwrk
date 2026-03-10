import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

// We mock the commands to avoid side effects during registration check
vi.mock("./commands/init.js", () => ({ initCommand: new Command("init") }));
vi.mock("./commands/define.js", () => ({
  defineCommand: new Command("define"),
}));
vi.mock("./commands/ship.js", () => ({ shipCommand: new Command("ship") }));
vi.mock("./commands/measure.js", () => ({
  measureCommand: new Command("measure"),
}));
vi.mock("./commands/tasks.js", () => ({ tasksCommand: new Command("tasks") }));
vi.mock("./commands/db.js", () => ({ dbCommand: new Command("db") }));
vi.mock("./commands/server.js", () => ({
  serverCommand: new Command("server"),
}));
vi.mock("./commands/status.js", () => ({
  statusCommand: new Command("status"),
}));
vi.mock("./utils/config.js", () => ({ loadConfig: vi.fn() }));

describe("FR-001 / FR-004: CLI Command Registration", () => {
  it("US-001 / US-003: registers Foxtrot Charlie pillar commands", async () => {
    const parseSpy = vi
      .spyOn(Command.prototype, "parse")
      .mockImplementation(() => {
        return {} as unknown as ReturnType<typeof Command.prototype.parse>;
      });

    // Re-import cli to trigger registration
    const { program } = await import("./cli.js");

    const commandNames = program.commands.map((c) => c.name());

    // Foxtrot Charlie pillars
    expect(commandNames).toContain("define");
    expect(commandNames).toContain("ship");
    expect(commandNames).toContain("measure");

    // Operational queries
    expect(commandNames).toContain("tasks");
    expect(commandNames).toContain("db");
    expect(commandNames).toContain("server");
    expect(commandNames).toContain("status");

    // Eliminated groups — must NOT exist as top-level
    const eliminated = [
      "run",
      "metrics",
      "implement",
      "pulse",
      "specify",
      "plan",
      "analyze",
      "new",
    ];
    for (const cmd of eliminated) {
      expect(commandNames).not.toContain(cmd);
    }

    parseSpy.mockRestore();
  });
});
