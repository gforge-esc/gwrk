import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { pluginCommand } from "./plugin";
import { PluginLoader } from "../plugins/loader";
import { PluginManager } from "../plugins/loader"; // Assuming Manager is in the same file or exported

vi.mock("../plugins/loader");

describe("TR-003: Plugin CLI Integration", () => {
  let program: Command;

  beforeEach(() => {
    vi.resetAllMocks();
    program = new Command();
    program.addCommand(pluginCommand);
  });

  it("US-001: 'gwrk plugin install <path>' should call installPlugin", async () => {
    const installSpy = vi.spyOn(PluginManager.prototype, "installPlugin").mockResolvedValue(undefined);
    
    await program.parseAsync(["node", "gwrk", "plugin", "install", "./my-skill"]);
    
    expect(installSpy).toHaveBeenCalledWith("./my-skill", expect.any(Object));
  });

  it("US-002: 'gwrk plugin list' should call listPlugins and format output", async () => {
    const listSpy = vi.spyOn(PluginLoader.prototype, "listPlugins").mockResolvedValue([
      { 
        name: "truth-extract", 
        type: "skill", 
        tier: "atomic", 
        version: "1.0.0", 
        description: "Extract truth",
        status: "active" 
      }
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await program.parseAsync(["node", "gwrk", "plugin", "list"]);

    expect(listSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("truth-extract"));
  });

  it("US-003: 'gwrk plugin remove <name>' should call removePlugin", async () => {
    const removeSpy = vi.spyOn(PluginManager.prototype, "removePlugin").mockResolvedValue(undefined);

    await program.parseAsync(["node", "gwrk", "plugin", "remove", "truth-extract"]);

    expect(removeSpy).toHaveBeenCalledWith("truth-extract", expect.any(Object));
  });

  it("US-004: 'gwrk plugin disable <name>' should update local config", async () => {
    // This might call a utility or the loader/manager
    // Assuming it's handled by PluginManager for now
    const disableSpy = vi.spyOn(PluginManager.prototype, "disablePlugin").mockResolvedValue(undefined);

    await program.parseAsync(["node", "gwrk", "plugin", "disable", "domains/writing"]);

    expect(disableSpy).toHaveBeenCalledWith("domains/writing");
  });

  it("FR-001: should exit with 1 on install error", async () => {
    vi.spyOn(PluginManager.prototype, "installPlugin").mockRejectedValue(new Error("No manifest.yaml found"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await program.parseAsync(["node", "gwrk", "plugin", "install", "./bad-dir"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No manifest.yaml found"));
  });
});
