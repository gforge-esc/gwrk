import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";
// @ts-ignore - Module does not exist yet (RED)
import { pluginCommand } from "./plugin.js";

describe("FR-001 / FR-003 / FR-004 / FR-005: Plugin CLI Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-001: 'gwrk plugin install <path>' validates and copies plugin", async () => {
    const program = new Command().addCommand(pluginCommand);
    const parseSpy = vi.spyOn(program, "parseAsync").mockImplementation(() => Promise.resolve({} as any));

    // We expect the command to be registered
    const installCmd = pluginCommand.commands.find(c => c.name() === "install");
    expect(installCmd).toBeDefined();
    expect(installCmd?.description()).toContain("Install a plugin");

    // We can't easily test the full implementation without mocking PluginLoader
    // but we can verify the command exists and has the right arguments
    expect(installCmd?.args).toContain("<path>");
  });

  it("US-002: 'gwrk plugin list' exists and supports --format json", () => {
    const listCmd = pluginCommand.commands.find(c => c.name() === "list");
    expect(listCmd).toBeDefined();
    
    const formatOption = listCmd?.options.find(o => o.flags.includes("--format <type>"));
    expect(formatOption).toBeDefined();

    const projectOption = listCmd?.options.find(o => o.flags.includes("--project"));
    expect(projectOption).toBeDefined();
  });

  it("US-003: 'gwrk plugin remove <name>' exists and supports --force", () => {
    const removeCmd = pluginCommand.commands.find(c => c.name() === "remove");
    expect(removeCmd).toBeDefined();
    expect(removeCmd?.args).toContain("<name>");

    const forceOption = removeCmd?.options.find(o => o.flags.includes("--force"));
    expect(forceOption).toBeDefined();
  });

  it("US-004: 'gwrk plugin disable <name>' exists", () => {
    const disableCmd = pluginCommand.commands.find(c => c.name() === "disable");
    expect(disableCmd).toBeDefined();
    expect(disableCmd?.args).toContain("<name>");
  });

  it("US-004: 'gwrk plugin enable <name>' exists", () => {
    const enableCmd = pluginCommand.commands.find(c => c.name() === "enable");
    expect(enableCmd).toBeDefined();
    expect(enableCmd?.args).toContain("<name>");
  });
});
