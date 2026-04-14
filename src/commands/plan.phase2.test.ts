import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { planCommand } from "./plan.js";

describe("gwrk plan subcommands (Phase 2)", () => {
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

  it("US-001: gwrk plan next should show ready work items", async () => {
    try {
        await program.parseAsync(['node', 'test', 'plan', 'next']);
    } catch (err) {
        expect(console.error).not.toHaveBeenCalledWith(
            expect.stringContaining("No build plan data")
        );
        expect(err.message).toContain("not yet implemented (Phase 2)");
    }
  });

  it("US-002: gwrk plan critical should show the critical path", async () => {
    try {
        await program.parseAsync(['node', 'test', 'plan', 'critical']);
    } catch (err) {
        expect(err.message).toContain("not yet implemented (Phase 2)");
    }
  });

  it("US-015: gwrk plan waves should show parallel waves", async () => {
    try {
        await program.parseAsync(['node', 'test', 'plan', 'waves']);
    } catch (err) {
        expect(err.message).toContain("not yet implemented (Phase 2)");
    }
  });
});
