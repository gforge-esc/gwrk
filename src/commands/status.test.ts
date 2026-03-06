import { describe, it, expect, vi, beforeEach } from "vitest";
import { statusCommand } from "./status.js";
import { Command } from "commander";

describe("status command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should output stopped if server is not running", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    // Fetch will fail because no server is on that port
    await statusCommand.parseAsync(["node", "test"]);
    
    expect(consoleSpy).toHaveBeenCalledWith("Server: stopped");
    consoleSpy.mockRestore();
  });

  it("should output JSON if --json is passed and server is stopped", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    await statusCommand.parseAsync(["node", "test", "--json"]);
    
    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ server: { status: "stopped" } }, null, 2));
    consoleSpy.mockRestore();
  });
});
