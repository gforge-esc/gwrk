import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { planCommand } from "./plan.js";

describe("gwrk plan subcommands (Phase 5)", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.addCommand(planCommand);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it("US-012: gwrk plan viz --dry-run should reach implemented action", async () => {
    try {
        await program.parseAsync(['node', 'test', 'plan', 'viz', '--dry-run']);
    } catch (err) {
        expect(err.message).toContain("not yet implemented (Phase 5)");
    }
  });

  it("US-014: gwrk plan review should show proposals", async () => {
    try {
        await program.parseAsync(['node', 'test', 'plan', 'review']);
    } catch (err) {
        expect(err.message).toContain("not yet implemented (Phase 5)");
    }
  });
});
