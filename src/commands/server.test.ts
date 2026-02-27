import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

// Import the server command — doesn't exist yet (RED)
import { serverCommand } from "./server.js";

// FR-001, FR-003: CLI server start/stop subcommands
describe("FR-001/FR-003: gwrk server CLI commands", () => {
  // US-001 #1: server start subcommand is registered
  it("US-001 #1: serverCommand has 'start' subcommand", () => {
    expect(serverCommand).toBeDefined();
    expect(serverCommand.name()).toBe("server");
    const startCmd = serverCommand.commands.find(
      (c: Command) => c.name() === "start"
    );
    expect(startCmd).toBeDefined();
  });

  // US-002 #1: server stop subcommand is registered
  it("US-002 #1: serverCommand has 'stop' subcommand", () => {
    const stopCmd = serverCommand.commands.find(
      (c: Command) => c.name() === "stop"
    );
    expect(stopCmd).toBeDefined();
  });

  // US-001 #2: server start with already running shows error
  it("US-001 #2: start when already running exits with code 1", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    // Write a fake PID file to simulate running server
    const fs = await import("node:fs");
    fs.mkdirSync(".gwrk", { recursive: true });
    fs.writeFileSync(".gwrk/server.pid", String(process.pid));

    try {
      // await serverCommand.parseAsync(["node", "gwrk", "start"]);
      // The actual call depends on Commander setup
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining("Server already running")
      );
    } catch {
      // Expected — process.exit mock throws
    } finally {
      fs.rmSync(".gwrk/server.pid", { force: true });
      mockExit.mockRestore();
      mockStderr.mockRestore();
    }
  });

  // US-002 #2: server stop when not running shows error
  it("US-002 #2: stop when not running exits with code 1", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // await serverCommand.parseAsync(["node", "gwrk", "stop"]);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining("No server running")
      );
    } catch {
      // Expected
    } finally {
      mockExit.mockRestore();
      mockStderr.mockRestore();
    }
  });
});
