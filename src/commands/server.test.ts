import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { serverCommand } from "./server.js";
import { readPid, isPidRunning, removePid, writePid } from "../server/pid.js";
import * as serverModule from "../server/index.js";
import { Command } from "commander";

vi.mock("../server/index.js", () => ({
  startServer: vi.fn().mockResolvedValue({}),
}));

describe("server command", () => {
  beforeEach(() => {
    removePid();
    vi.clearAllMocks();
  });

  afterEach(() => {
    removePid();
  });

  it("should have start and stop subcommands", () => {
    const start = serverCommand.commands.find(c => c.name() === "start");
    const stop = serverCommand.commands.find(c => c.name() === "stop");
    expect(start).toBeDefined();
    expect(stop).toBeDefined();
  });

  it("start should call startServer if no server is running", async () => {
    await serverCommand.parseAsync(["node", "test", "start"]);
    expect(serverModule.startServer).toHaveBeenCalled();
  });

  it("start should fail if server is already running", async () => {
    writePid(process.pid);
    
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => { 
      throw new Error(`Exit ${code}`); 
    });

    try {
      await serverCommand.parseAsync(["node", "test", "start"]);
    } catch (e: any) {
      // Commander might catch the error and re-throw or call exit
    }

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Server already running"));
    expect(serverModule.startServer).not.toHaveBeenCalled();
    
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
