import { describe, expect, it, vi, beforeEach } from "vitest";
import { Command } from "commander";
// @ts-ignore - Module does not exist yet (RED)
import { syncContextCommand } from "./sync-context.js";

describe("FR-L1-006: gwrk plugin sync-context Command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.addCommand(syncContextCommand);
    vi.clearAllMocks();
  });

  it("US-L1-002: regenerates CLI context files from .gwrk/agent-context.md", async () => {
    // This command should call syncGovernance() on all active adapters
    await program.parseAsync(["plugin", "sync-context"]);
  });

  it("fails if not in a gwrk project", async () => {
      // Should throw or exit 1 if .gwrk/ doesn't exist
      await expect(program.parseAsync(["plugin", "sync-context"])).rejects.toThrow(/Not a gwrk project/);
  });
});
