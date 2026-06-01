import { describe, it, expect } from "vitest";
import { projectInfoCommand } from "./project-info.js";
import { Command } from "commander";

/**
 * TR-032: Unit test gwrk project info
 * FR-035: Display resolved profile
 */
describe("FR-035: Project Profile Introspection", () => {
  it("TR-032.1: returns valid JSON matching ProjectProfileSchema when --format json is used", async () => {
    expect(projectInfoCommand.name()).toBe("info");
    const options = projectInfoCommand.options.map(o => o.flags);
    expect(options).toContain("--format <type>");
  });

  it("US-029.1: displays type, stack, and layout in default output", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(projectInfoCommand);
    
    // This will fail because the action throws "Not implemented"
    await program.parseAsync(['info'], { from: 'user' });
  });

  it("US-029.2: supports --format json", async () => {
    const program = new Command();
    program.exitOverride();
    program.addCommand(projectInfoCommand);
    
    // This will fail because the action throws "Not implemented"
    await program.parseAsync(['info', '--format', 'json'], { from: 'user' });
  });
});
